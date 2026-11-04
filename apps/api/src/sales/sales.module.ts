import { BadRequestException, Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNumber, Min, ValidateNested } from 'class-validator';
import { BusinessLineCode, Prisma, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { StockService } from '../stock/stock.service.js';
import { PaymentDto, SaleDto, SalesService } from './sales.service.js';
import { overLimit, withCustomerBalances } from '../common/balances.js';


class PriceDto {
  @IsEnum(UnitName) unitName: UnitName;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) rate: number;
}
class PricesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PriceDto) prices: PriceDto[];
}

interface SaleQuery {
  customerId?: string;
  line?: BusinessLineCode;
  salesmanId?: string;
  status?: 'ACTIVE' | 'CANCELLED';
  from?: string;
  to?: string;
  limit?: string;
}

const range = (from?: string, to?: string) =>
  from || to ? { gte: from ? dayOf(from) : undefined, lte: to ? dayOf(to) : undefined } : undefined;

@Controller()
class SalesController {
  constructor(private prisma: PrismaService, private sales: SalesService, private stock: StockService, private audit: AuditService) {}

  // ---------------------------------------------------------------- sales

  /** Dry run: totals, balances, credit-limit status and stock shortages, nothing saved. */
  @Post('sales/preview') @RequirePermissions('SALE_CREATE')
  preview(@Body() dto: SaleDto, @CurrentUser() u: AuthUser) {
    return this.sales.preview(dto, u);
  }

  @Post('sales') @RequirePermissions('SALE_CREATE')
  create(@Body() dto: SaleDto, @CurrentUser() u: AuthUser) {
    return this.sales.create(dto, u);
  }

  @Get('sales') @RequirePermissions('SALE_CREATE')
  list(@Query() q: SaleQuery) {
    return this.prisma.sale.findMany({
      where: {
        customerId: q.customerId, businessLine: q.line, salesmanId: q.salesmanId, status: q.status,
        date: range(q.from, q.to),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Number(q.limit) || 100, 500),
      include: { customer: { select: { name: true, shopName: true } }, salesman: { select: { name: true } }, location: { select: { name: true } } },
    });
  }

  @Get('sales/:id') @RequirePermissions('SALE_CREATE')
  one(@Param('id') id: string) {
    return this.sales.view(id);
  }

  @Post('sales/:id/cancel') @RequirePermissions('SALE_CANCEL')
  cancel(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    return this.sales.cancel(id, u);
  }

  // ------------------------------------------------------------- payments

  /** Money received from a customer outside a bill. The receipt shows the balance before and after. */
  @Post('payments') @RequirePermissions('PAYMENT_RECORD')
  async pay(@Body() dto: PaymentDto, @CurrentUser() u: AuthUser) {
    return this.receipt(await this.sales.recordPayment(dto, u));
  }

  /** Collections log: who recorded which payment, when. */
  @Get('payments') @RequirePermissions('PAYMENT_RECORD')
  payments(@Query() q: { customerId?: string; userId?: string; from?: string; to?: string; limit?: string }) {
    return this.prisma.payment.findMany({
      where: { customerId: q.customerId, createdById: q.userId, date: range(q.from, q.to) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(q.limit) || 100, 500),
      include: { customer: { select: { name: true, shopName: true } } },
    });
  }

  @Get('payments/:id') @RequirePermissions('PAYMENT_RECORD')
  receipt(@Param('id') id: string) {
    return this.prisma.payment
      .findUnique({ where: { id }, include: { customer: { select: { name: true, shopName: true, phone: true } }, sale: { select: { billNo: true } } } })
      .then(async (p) => {
        if (!p) throw new NotFoundException();
        const by = await this.prisma.appUser.findUnique({ where: { id: p.createdById }, select: { username: true } });
        return { ...p, recordedBy: by?.username ?? null };
      });
  }

  // -------------------------------------------------------------- cheques

  /** Customer cheques: pending ones by the date on the cheque (soonest first), or cleared / bounced. */
  @Get('cheques') @RequirePermissions('PAYMENT_RECORD')
  cheques(@Query('status') status?: string) {
    const st = status === 'CLEARED' || status === 'BOUNCED' ? status : 'PENDING';
    return this.prisma.payment.findMany({
      where: { method: 'CHEQUE', chequeStatus: st },
      orderBy: st === 'PENDING' ? [{ chequeDate: 'asc' }, { createdAt: 'asc' }] : [{ chequeSettledAt: 'desc' }],
      take: 300,
      include: { customer: { select: { id: true, name: true, shopName: true, phone: true } } },
    });
  }

  /** The bank paid the cheque. Nothing changes in the khata: it was credited when received. */
  @Post('cheques/:id/clear') @RequirePermissions('PAYMENT_RECORD')
  async clearCheque(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const p = await this.pendingCheque(id);
    const row = await this.prisma.payment.update({ where: { id }, data: { chequeStatus: 'CLEARED', chequeSettledAt: new Date() } });
    await this.audit.log(u.id, 'CHEQUE_CLEARED', 'Payment', id, { chequeStatus: p.chequeStatus }, { chequeStatus: 'CLEARED' });
    return row;
  }

  /** The cheque bounced: the receipt is cancelled and the amount goes back on the customer's khata. */
  @Post('cheques/:id/bounce') @RequirePermissions('SALE_CANCEL')
  async bounceCheque(@Param('id') id: string, @Body() body: { note?: string }, @CurrentUser() u: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const p = await this.pendingCheque(id, tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'customer:' + p.customerId}))`;
      await tx.payment.update({ where: { id }, data: { status: 'CANCELLED', chequeStatus: 'BOUNCED', chequeSettledAt: new Date() } });
      await tx.customerLedger.create({
        data: {
          customerId: p.customerId, date: dayOf(), amount: p.amount, refType: 'CHEQUE_BOUNCED', refId: p.id,
          note: `Cheque ${p.chequeNo}${p.chequeBank ? ` (${p.chequeBank})` : ''} bounced · ${p.receiptNo}${typeof body?.note === 'string' && body.note.trim() ? ` · ${body.note.trim().slice(0, 120)}` : ''}`,
          createdById: u.id,
        },
      });
    });
    await this.audit.log(u.id, 'CHEQUE_BOUNCED', 'Payment', id);
    return this.receipt(id);
  }

  private async pendingCheque(id: string, db: Pick<PrismaService, 'payment'> = this.prisma) {
    const p = await db.payment.findUnique({ where: { id } });
    if (!p || p.method !== 'CHEQUE') throw new NotFoundException('Not a cheque payment');
    if (p.chequeStatus !== 'PENDING' || p.status !== 'ACTIVE') throw new ConflictException(`This cheque is already ${(p.chequeStatus ?? 'settled').toLowerCase()}`);
    return p;
  }

  /** Cancels a standalone receipt. A receipt that came with a bill is cancelled with the bill. */
  @Post('payments/:id/cancel') @RequirePermissions('SALE_CANCEL')
  async cancelPayment(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    await this.prisma.$transaction(async (tx) => {
      const p = await tx.payment.findUnique({ where: { id } });
      if (!p) throw new NotFoundException();
      if (p.saleId) throw new BadRequestException('This receipt belongs to a bill; cancel the bill instead');
      if (p.status === 'CANCELLED') throw new ConflictException('Already cancelled');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'customer:' + p.customerId}))`;
      await tx.payment.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.customerLedger.create({
        data: { customerId: p.customerId, date: dayOf(), amount: p.amount, refType: 'PAYMENT_CANCEL', refId: p.id, note: `Cancel ${p.receiptNo}`, createdById: u.id },
      });
    });
    await this.audit.log(u.id, 'CANCEL', 'Payment', id);
    return this.receipt(id);
  }

  // ---------------------------------------------------------------- khata

  /** Outstanding balances, highest first, flagging customers over their credit limit. */
  @Get('khata/balances') @RequirePermissions('PAYMENT_RECORD')
  async balances(@Query('area') area?: string) {
    const customers = await withCustomerBalances(this.prisma, await this.prisma.customer.findMany({ where: { isActive: true, area }, orderBy: { name: 'asc' } }));
    return customers
      .map((c) => {
        const balance = c.balance;
        return {
          id: c.id, name: c.name, shopName: c.shopName, area: c.area, phone: c.phone, type: c.type,
          creditLimit: c.creditLimit, balance, overLimit: overLimit(balance, c.creditLimit),
        };
      })
      .sort((a, b) => b.balance.comparedTo(a.balance));
  }

  /**
   * Customer statement for a date range: balance brought forward, every bill, payment and
   * correction in the range (bills with what was in them), and the closing balance.
   */
  @Get('khata/:customerId/statement') @RequirePermissions('PAYMENT_RECORD')
  async statement(@Param('customerId') customerId: string, @Query('from') fromQ?: string, @Query('to') toQ?: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException();
    const to = dayOf(toQ);
    const from = fromQ ? dayOf(fromQ) : new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    if (to < from) throw new BadRequestException('"to" is before "from"');
    const [before, entries] = await Promise.all([
      this.prisma.customerLedger.aggregate({ where: { customerId, date: { lt: from } }, _sum: { amount: true } }),
      this.prisma.customerLedger.findMany({ where: { customerId, date: { gte: from, lte: to } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const saleIds = entries.filter((e) => e.refType === 'SALE' || e.refType === 'SALE_CANCEL').map((e) => e.refId);
    const payIds = entries.filter((e) => e.refType !== 'SALE' && e.refType !== 'SALE_CANCEL').map((e) => e.refId);
    const [sales, payments] = await Promise.all([
      this.prisma.sale.findMany({
        where: { id: { in: saleIds } },
        select: { id: true, billNo: true, paidNow: true, items: { select: { qty: true, unitName: true, lineTotal: true, product: { select: { name: true, size: true } } } } },
      }),
      this.prisma.payment.findMany({ where: { id: { in: payIds } }, select: { id: true, receiptNo: true, method: true, chequeNo: true } }),
    ]);
    const opening = customer.openingBalance.plus(before._sum.amount ?? 0);
    let running = opening;
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    const rows = entries.map((e) => {
      running = running.plus(e.amount);
      if (e.amount.gt(0)) debit = debit.plus(e.amount); else credit = credit.plus(e.amount.neg());
      const sale = sales.find((x) => x.id === e.refId);
      const pay = payments.find((x) => x.id === e.refId);
      return {
        id: e.id, date: e.date, refType: e.refType, refId: e.refId, note: e.note, amount: e.amount, balance: running,
        ref: sale?.billNo ?? pay?.receiptNo ?? e.note,
        method: pay?.method ?? null, chequeNo: pay?.chequeNo ?? null,
        items: e.refType === 'SALE' && sale ? sale.items.map((i) => ({ name: i.product.size ? `${i.product.name} ${i.product.size}` : i.product.name, qty: i.qty, unitName: i.unitName, lineTotal: i.lineTotal })) : undefined,
      };
    });
    return {
      customer: { id: customer.id, name: customer.name, shopName: customer.shopName, phone: customer.phone, area: customer.area, address: customer.address, creditLimit: customer.creditLimit },
      from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10),
      opening, debit, credit, closing: running, entries: rows,
    };
  }

  @Get('khata/:customerId') @RequirePermissions('PAYMENT_RECORD')
  async ledger(@Param('customerId') customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException();
    const [entries, empties] = await Promise.all([
      this.prisma.customerLedger.findMany({ where: { customerId }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.emptiesLedger.groupBy({ by: ['productId'], where: { customerId }, _sum: { qtyOut: true, qtyIn: true } }),
    ]);
    const names = await this.prisma.product.findMany({ where: { id: { in: empties.map((e) => e.productId) } }, select: { id: true, name: true } });
    let running = customer.openingBalance;
    return {
      customer: { id: customer.id, name: customer.name, shopName: customer.shopName, type: customer.type, creditLimit: customer.creditLimit },
      openingBalance: customer.openingBalance,
      entries: entries.map((e) => {
        running = running.plus(e.amount);
        return { ...e, balance: running };
      }),
      balance: running,
      emptiesHeld: empties
        .map((e) => ({ productId: e.productId, name: names.find((n) => n.id === e.productId)?.name, held: (e._sum.qtyOut ?? 0) - (e._sum.qtyIn ?? 0) }))
        .filter((e) => e.held !== 0),
    };
  }

  // --------------------------------------------------------- list prices

  @Get('product-prices')
  prices(@Query('productId') productId?: string) {
    return this.prisma.productPrice.findMany({ where: { productId } });
  }

  @Put('product-prices/:productId') @RequirePermissions('RATE_EDIT')
  async setPrices(@Param('productId') productId: string, @Body() dto: PricesDto, @CurrentUser() u: AuthUser) {
    const units = await this.prisma.productUnit.findMany({ where: { productId } });
    if (dto.prices.some((p) => !units.some((x) => x.unitName === p.unitName))) throw new BadRequestException('Unit not available for this product');
    const before = await this.prisma.productPrice.findMany({ where: { productId } });
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.productPrice.deleteMany({ where: { productId } });
      await tx.productPrice.createMany({ data: dto.prices.map((p) => ({ ...p, productId })) });
      return tx.productPrice.findMany({ where: { productId } });
    });
    await this.audit.log(u.id, 'SET_PRICES', 'Product', productId, before, after);
    return after;
  }
}

@Module({ controllers: [SalesController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
