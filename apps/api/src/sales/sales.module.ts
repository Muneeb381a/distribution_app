import { BadRequestException, Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { BusinessLineCode, Prisma, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { StockService } from '../stock/stock.service.js';
import { PaymentDto, SaleDto, SalesService } from './sales.service.js';
import { overLimit, withCustomerBalances } from '../common/balances.js';
import { loadAllocations } from '../common/allocation.js';


class PriceDto {
  @IsEnum(UnitName) unitName: UnitName;
  /** Price list; retail when left out. */
  @IsOptional() @IsIn(['RETAIL', 'WHOLESALE']) tier?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) rate: number;
}
class PricesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PriceDto) prices: PriceDto[];
}

/**
 * Change many list prices at once: by a percentage (every unit), or by a fixed amount per one unit
 * (e.g. +Rs 50 a peti), which moves the product's other units in proportion (+Rs 8.33 a bottle).
 */
class ChangePricesDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) productIds: string[];
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-90) @Max(500) percent?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) amount?: number;
  /** The unit the fixed amount is for. */
  @IsOptional() @IsEnum(UnitName) unitName?: UnitName;
  /** Round new rates to the nearest 1, 5 or 10 rupees (default 1). */
  @IsOptional() @IsIn([0.01, 1, 5, 10]) roundTo?: number;
  /** Change only this price list; both when left out. */
  @IsOptional() @IsIn(['RETAIL', 'WHOLESALE']) tier?: string;
  /** Only work out the new rates; change nothing. */
  @IsOptional() @IsBoolean() preview?: boolean;
}

interface SaleQuery {
  customerId?: string;
  line?: BusinessLineCode;
  salesmanId?: string;
  status?: 'ACTIVE' | 'CANCELLED';
  /** PENDING = dispatched but not yet signed for. */
  delivery?: 'PENDING' | 'DELIVERED';
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
  async list(@Query() q: SaleQuery) {
    const sales = await this.prisma.sale.findMany({
      where: {
        customerId: q.customerId, businessLine: q.line, salesmanId: q.salesmanId, status: q.delivery === 'PENDING' ? 'ACTIVE' : q.status,
        deliveryStatus: q.delivery === 'PENDING' || q.delivery === 'DELIVERED' ? q.delivery : undefined,
        date: range(q.from, q.to),
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: Math.min(Number(q.limit) || 100, 500),
      include: { customer: { select: { name: true, shopName: true } }, salesman: { select: { name: true } }, location: { select: { name: true } } },
    });
    // Paid / part / unpaid per bill, worked out the same way as on the khata.
    const alloc = await loadAllocations(this.prisma, sales.flatMap((x) => (x.customerId && x.status === 'ACTIVE' ? [x.customerId] : [])));
    const vehicles = new Map((await this.prisma.location.findMany({ where: { id: { in: [...new Set(sales.flatMap((x) => (x.vehicleId ? [x.vehicleId] : [])))] } }, select: { id: true, name: true } })).map((v) => [v.id, v.name]));
    return sales.map((x) => {
      const bill = x.customerId ? alloc.get(x.customerId)?.bills.find((b) => b.saleId === x.id) : undefined;
      return { ...x, vehicleName: x.vehicleId ? vehicles.get(x.vehicleId) ?? null : null, payStatus: bill?.status ?? null, paid: bill?.paid ?? null, remaining: bill?.remaining ?? null };
    });
  }

  @Get('sales/:id') @RequirePermissions('SALE_CREATE')
  one(@Param('id') id: string) {
    return this.sales.view(id);
  }

  /** The customer's side has the goods: record who signed for them. */
  @Post('sales/:id/deliver') @RequirePermissions('SALE_CREATE')
  deliver(@Param('id') id: string, @Body() body: { receivedBy?: string }, @CurrentUser() u: AuthUser) {
    return this.sales.deliver(id, typeof body?.receivedBy === 'string' ? body.receivedBy : '', u);
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
    const alloc = (await loadAllocations(this.prisma, [customerId])).get(customerId);
    const opening = customer.openingBalance.plus(before._sum.amount ?? 0);
    let running = opening;
    let debit = new Prisma.Decimal(0);
    let credit = new Prisma.Decimal(0);
    const rows = entries.map((e) => {
      running = running.plus(e.amount);
      if (e.amount.gt(0)) debit = debit.plus(e.amount); else credit = credit.plus(e.amount.neg());
      const sale = sales.find((x) => x.id === e.refId);
      const pay = payments.find((x) => x.id === e.refId);
      const billOf = e.refType === 'SALE' ? alloc?.bills.find((b) => b.saleId === e.refId) : undefined;
      return {
        id: e.id, date: e.date, refType: e.refType, refId: e.refId, note: e.note, amount: e.amount, balance: running,
        ref: sale?.billNo ?? pay?.receiptNo ?? e.note,
        method: pay?.method ?? null, chequeNo: pay?.chequeNo ?? null,
        // What is still owed on this bill today, or which bills this receipt paid (oldest first).
        bill: billOf ? { paid: billOf.paid, remaining: billOf.remaining, status: billOf.status } : undefined,
        appliedTo: e.refType === 'PAYMENT' ? alloc?.payments.find((a) => a.paymentId === e.refId)?.applied : undefined,
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
    const alloc = (await loadAllocations(this.prisma, [customerId])).get(customerId);
    const receipts = await this.prisma.payment.findMany({ where: { customerId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
    const users = await this.prisma.appUser.findMany({ where: { id: { in: [...new Set(receipts.map((r) => r.createdById))] } }, select: { id: true, username: true } });
    const billNos = new Map((await this.prisma.sale.findMany({ where: { customerId }, select: { id: true, billNo: true } })).map((x) => [x.id, x.billNo]));
    let running = customer.openingBalance;
    return {
      customer: { id: customer.id, name: customer.name, shopName: customer.shopName, type: customer.type, creditLimit: customer.creditLimit },
      openingBalance: customer.openingBalance,
      entries: entries.map((e) => {
        running = running.plus(e.amount);
        return { ...e, balance: running };
      }),
      balance: running,
      /** Bills with what is paid / left, and every receipt with the bills it paid: the installment history. */
      bills: (alloc?.bills ?? []).map((b) => ({ saleId: b.saleId, billNo: b.billNo, date: b.date, net: b.net, paid: b.paid, remaining: b.remaining, status: b.status, ageDays: b.ageDays })),
      openingRemaining: alloc?.openingRemaining ?? customer.openingBalance,
      advance: alloc?.advance ?? 0,
      receipts: receipts.map((r) => ({
        id: r.id, receiptNo: r.receiptNo, date: r.date, createdAt: r.createdAt, amount: r.amount, method: r.method, status: r.status,
        chequeNo: r.chequeNo, chequeStatus: r.chequeStatus, note: r.note, saleId: r.saleId, billNo: r.saleId ? billNos.get(r.saleId) ?? null : null,
        recordedBy: users.find((u) => u.id === r.createdById)?.username ?? null,
        previousBalance: r.previousBalance, newBalance: r.newBalance,
        applied: alloc?.payments.find((a) => a.paymentId === r.id)?.applied ?? [],
        unallocated: alloc?.payments.find((a) => a.paymentId === r.id)?.unallocated ?? 0,
      })),
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

  @Post('product-prices/change') @RequirePermissions('RATE_EDIT')
  async changePrices(@Body() dto: ChangePricesDto, @CurrentUser() u: AuthUser) {
    const pct = dto.percent ?? 0;
    const amt = dto.amount ?? 0;
    if (!pct && !amt) throw new BadRequestException('Give a percentage or an amount');
    if (pct && amt) throw new BadRequestException('Give a percentage or an amount, not both');
    if (amt && !dto.unitName) throw new BadRequestException('Say which unit the amount is for');
    const step = new Prisma.Decimal(dto.roundTo ?? 1);
    const [prices, products] = await Promise.all([
      this.prisma.productPrice.findMany({ where: { productId: { in: dto.productIds }, tier: dto.tier } }),
      this.prisma.product.findMany({ where: { id: { in: dto.productIds } }, select: { id: true, name: true, size: true, units: { select: { unitName: true, factorToBase: true } } } }),
    ]);
    const rows = prices.map((p) => {
      const product = products.find((x) => x.id === p.productId)!;
      const factor = (unit: string) => product.units.find((x) => x.unitName === unit)?.factorToBase;
      let next: Prisma.Decimal;
      if (pct) next = p.rate.mul(new Prisma.Decimal(100).plus(pct)).div(100);
      else {
        const per = factor(dto.unitName!);
        // A product without the chosen unit is left as it is.
        if (!per) return { productId: p.productId, name: product.name, size: product.size, unitName: p.unitName, tier: p.tier, from: p.rate, to: p.rate, skipped: true };
        next = p.rate.plus(new Prisma.Decimal(amt).div(per).mul(factor(p.unitName) ?? 1));
      }
      next = next.div(step).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).mul(step).toDecimalPlaces(2);
      if (next.lt(0)) throw new BadRequestException(`${product.name}: the ${p.unitName.toLowerCase()} rate would go below zero`);
      return { productId: p.productId, name: product.name, size: product.size, unitName: p.unitName, tier: p.tier, from: p.rate, to: next, skipped: false };
    }).sort((a, b) => a.name.localeCompare(b.name) || a.unitName.localeCompare(b.unitName) || b.tier.localeCompare(a.tier));
    const changed = rows.filter((r) => !r.to.equals(r.from));
    if (!dto.preview && changed.length) {
      await this.prisma.$transaction(changed.map((r) => this.prisma.productPrice.update({ where: { productId_unitName_tier: { productId: r.productId, unitName: r.unitName, tier: r.tier } }, data: { rate: r.to } })));
      await this.audit.log(u.id, 'CHANGE_PRICES', 'Product', undefined, undefined, { percent: dto.percent, amount: dto.amount, unitName: dto.unitName, roundTo: dto.roundTo, tier: dto.tier, rates: changed.map((r) => [r.name, r.unitName, r.tier, r.from, r.to]) });
    }
    return { applied: !dto.preview, changed: changed.length, withoutRate: dto.productIds.filter((id) => !prices.some((p) => p.productId === id)).length, rows };
  }

  @Put('product-prices/:productId') @RequirePermissions('RATE_EDIT')
  async setPrices(@Param('productId') productId: string, @Body() dto: PricesDto, @CurrentUser() u: AuthUser) {
    const units = await this.prisma.productUnit.findMany({ where: { productId } });
    if (dto.prices.some((p) => !units.some((x) => x.unitName === p.unitName))) throw new BadRequestException('Unit not available for this product');
    const before = await this.prisma.productPrice.findMany({ where: { productId } });
    const after = await this.prisma.$transaction(async (tx) => {
      await tx.productPrice.deleteMany({ where: { productId } });
      const seen = new Set<string>();
      for (const p of dto.prices) {
        const k = `${p.unitName}|${p.tier ?? 'RETAIL'}`;
        if (seen.has(k)) throw new BadRequestException(`Two ${(p.tier ?? 'retail').toLowerCase()} rates for ${p.unitName.toLowerCase()}`);
        seen.add(k);
      }
      await tx.productPrice.createMany({ data: dto.prices.map((p) => ({ ...p, tier: p.tier ?? 'RETAIL', productId })) });
      return tx.productPrice.findMany({ where: { productId } });
    });
    await this.audit.log(u.id, 'SET_PRICES', 'Product', productId, before, after);
    return after;
  }
}

@Module({ controllers: [SalesController], providers: [SalesService], exports: [SalesService] })
export class SalesModule {}
