import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, ValidateNested } from 'class-validator';
import { Prisma, StockStatus, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { StockService, type Tx } from '../stock/stock.service.js';

const D = Prisma.Decimal;

class PurchaseItemDto {
  @IsUUID() productId: string;
  @IsEnum(UnitName) unitName: UnitName;
  @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() qty: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) unitPrice: number;
}

class PurchaseDto {
  @IsUUID() supplierId: string;
  @IsUUID() locationId: string;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) paidNow?: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => PurchaseItemDto) items: PurchaseItemDto[];
}

class ReturnItemDto extends PurchaseItemDto {
  @IsEnum(['OK', 'DAMAGED']) fromStatus: StockStatus;
}

class PurchaseReturnDto {
  @IsUUID() supplierId: string;
  @IsUUID() locationId: string;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => ReturnItemDto) items: ReturnItemDto[];
}

class PaymentDto {
  @IsUUID() supplierId: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() note?: string;
}

@Controller()
class PurchasingController {
  constructor(private prisma: PrismaService, private stock: StockService, private audit: AuditService) {}

  // ---------- purchases ----------

  @Get('purchases') @RequirePermissions('PURCHASE_MANAGE')
  purchases() {
    return this.prisma.purchase.findMany({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { supplier: { select: { name: true } }, location: { select: { name: true } } },
    });
  }

  @Get('purchases/:id') @RequirePermissions('PURCHASE_MANAGE')
  async purchase(@Param('id') id: string) {
    const p = await this.prisma.purchase.findUnique({
      where: { id },
      include: { supplier: true, location: true, items: { include: { product: { select: { name: true, size: true } } } } },
    });
    if (!p) throw new NotFoundException();
    return p;
  }

  @Post('purchases') @RequirePermissions('PURCHASE_MANAGE')
  async createPurchase(@Body() dto: PurchaseDto, @CurrentUser() user: AuthUser) {
    const result = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier?.isActive) throw new BadRequestException('Unknown or inactive supplier');
      await this.stock.requireLocation(tx, dto.locationId, ['GODOWN', 'SHOP']);

      const lines = await this.priceLines(tx, dto.items);
      const total = lines.reduce((s, l) => s.plus(l.lineTotal), new D(0));
      const paid = new D(dto.paidNow ?? 0);
      if (paid.gt(total)) throw new BadRequestException('Paid now cannot be more than the purchase total');

      const purchaseNo = await this.stock.nextNo(tx, 'PURCHASE', 'P');
      const date = dayOf(dto.date);
      const purchase = await tx.purchase.create({
        data: {
          purchaseNo, supplierId: dto.supplierId, locationId: dto.locationId, date, total, paidNow: paid, note: dto.note, createdById: user.id,
          items: { create: lines.map(({ factor: _factor, ...l }) => l) },
        },
        include: { items: true },
      });

      // Stable product order so concurrent documents take their stock locks in the same order.
      for (const l of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        await this.stock.move(tx, {
          productId: l.productId, locationId: dto.locationId, qtyBase: l.qtyBase, type: 'PURCHASE',
          refType: 'PURCHASE', refId: purchase.id, userId: user.id,
        });
        // Latest-cost method: the most recent purchase price, per base unit.
        const unitCost = new D(l.unitPrice).div(l.factor).toDecimalPlaces(4);
        await tx.productCost.upsert({
          where: { productId: l.productId },
          update: { latestUnitCostBase: unitCost },
          create: { productId: l.productId, latestUnitCostBase: unitCost },
        });
      }
      await tx.supplierLedger.create({
        data: { supplierId: dto.supplierId, date, amount: total, refType: 'PURCHASE', refId: purchase.id, createdById: user.id, note: purchaseNo },
      });
      if (paid.gt(0)) await this.recordPayment(tx, { supplierId: dto.supplierId, amount: paid, method: dto.method, date, note: `With ${purchaseNo}`, userId: user.id });
      return purchase;
    });
    await this.audit.log(user.id, 'CREATE', 'Purchase', result.id, undefined, result);
    return result;
  }

  /** Reverses stock and the supplier ledger. Fails if the goods have already been sold or moved on. */
  @Post('purchases/:id/cancel') @RequirePermissions('PURCHASE_MANAGE')
  async cancelPurchase(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const cancelled = await this.prisma.$transaction(async (tx) => {
      const p = await tx.purchase.findUnique({ where: { id }, include: { items: true } });
      if (!p) throw new NotFoundException();
      if (p.status === 'CANCELLED') throw new BadRequestException('Already cancelled');
      for (const it of [...p.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        await this.stock.move(tx, {
          productId: it.productId, locationId: p.locationId, qtyBase: it.qtyBase.neg(), type: 'PURCHASE_CANCEL',
          refType: 'PURCHASE', refId: p.id, userId: user.id,
        });
      }
      // A cancelled purchase must not keep setting the cost: fall back to the latest remaining purchase price.
      for (const it of p.items) {
        const prev = await tx.purchaseItem.findFirst({
          where: { productId: it.productId, purchase: { status: 'ACTIVE', id: { not: p.id } } },
          orderBy: [{ purchase: { date: 'desc' } }, { purchase: { createdAt: 'desc' } }],
        });
        if (prev) {
          const factor = prev.qtyBase.div(prev.qty);
          await tx.productCost.update({ where: { productId: it.productId }, data: { latestUnitCostBase: prev.unitPrice.div(factor).toDecimalPlaces(4) } });
        }
      }
      await tx.supplierLedger.create({
        data: { supplierId: p.supplierId, date: dayOf(), amount: p.total.neg(), refType: 'CANCEL', refId: p.id, createdById: user.id, note: `Cancel ${p.purchaseNo}` },
      });
      return tx.purchase.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await this.audit.log(user.id, 'CANCEL', 'Purchase', id, undefined, cancelled);
    return cancelled;
  }

  // ---------- returns to supplier ----------

  @Get('purchase-returns') @RequirePermissions('PURCHASE_MANAGE')
  returns() {
    return this.prisma.purchaseReturn.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { supplier: { select: { name: true } }, location: { select: { name: true } }, items: true },
    });
  }

  @Post('purchase-returns') @RequirePermissions('PURCHASE_MANAGE')
  async createReturn(@Body() dto: PurchaseReturnDto, @CurrentUser() user: AuthUser) {
    const result = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw new BadRequestException('Unknown supplier');
      await this.stock.requireLocation(tx, dto.locationId);
      const lines = await this.priceLines(tx, dto.items);
      const total = lines.reduce((s, l) => s.plus(l.lineTotal), new D(0));
      const returnNo = await this.stock.nextNo(tx, 'PURCHASE_RETURN', 'PR');
      const date = dayOf(dto.date);
      const ret = await tx.purchaseReturn.create({
        data: {
          returnNo, supplierId: dto.supplierId, locationId: dto.locationId, date, total, note: dto.note, createdById: user.id,
          items: { create: lines.map(({ factor: _factor, ...l }, i) => ({ ...l, fromStatus: dto.items[i].fromStatus })) },
        },
        include: { items: true },
      });
      const order = lines.map((l, i) => ({ l, status: dto.items[i].fromStatus })).sort((a, b) => a.l.productId.localeCompare(b.l.productId));
      for (const { l, status } of order) {
        await this.stock.move(tx, {
          productId: l.productId, locationId: dto.locationId, qtyBase: l.qtyBase.neg(), status, type: 'PURCHASE_RETURN',
          refType: 'PURCHASE_RETURN', refId: ret.id, userId: user.id,
        });
      }
      await tx.supplierLedger.create({
        data: { supplierId: dto.supplierId, date, amount: total.neg(), refType: 'RETURN', refId: ret.id, createdById: user.id, note: returnNo },
      });
      return ret;
    });
    await this.audit.log(user.id, 'CREATE', 'PurchaseReturn', result.id, undefined, result);
    return result;
  }

  // ---------- supplier payments and ledger ----------

  @Post('supplier-payments') @RequirePermissions('SUPPLIER_PAYMENT')
  async pay(@Body() dto: PaymentDto, @CurrentUser() user: AuthUser) {
    const payment = await this.prisma.$transaction(async (tx) => {
      const supplier = await tx.supplier.findUnique({ where: { id: dto.supplierId } });
      if (!supplier) throw new BadRequestException('Unknown supplier');
      return this.recordPayment(tx, { supplierId: dto.supplierId, amount: new D(dto.amount), method: dto.method, date: dayOf(dto.date), note: dto.note, userId: user.id });
    });
    await this.audit.log(user.id, 'CREATE', 'SupplierPayment', payment.id, undefined, payment);
    return payment;
  }

  /** What we owe each supplier (positive) or what they owe us (negative). */
  @Get('suppliers/balances') @RequirePermissions('PURCHASE_MANAGE')
  async balances() {
    const [suppliers, sums] = await Promise.all([
      this.prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.supplierLedger.groupBy({ by: ['supplierId'], _sum: { amount: true } }),
    ]);
    return suppliers.map((s) => ({
      id: s.id, name: s.name, type: s.type,
      balance: s.openingBalance.plus(sums.find((x) => x.supplierId === s.id)?._sum.amount ?? 0),
    }));
  }

  @Get('suppliers/:id/ledger') @RequirePermissions('PURCHASE_MANAGE')
  async ledger(@Param('id') id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException();
    const entries = await this.prisma.supplierLedger.findMany({ where: { supplierId: id }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    let running = supplier.openingBalance;
    return {
      supplier: { id: supplier.id, name: supplier.name },
      openingBalance: supplier.openingBalance,
      entries: entries.map((e) => {
        running = running.plus(e.amount);
        return { ...e, balance: running };
      }),
      balance: running,
    };
  }

  // ---------- helpers ----------

  private async priceLines(tx: Tx, items: PurchaseItemDto[]) {
    const out = [];
    for (const it of items) {
      await this.stock.requireProduct(tx, it.productId);
      const { qtyBase, factor } = await this.stock.toBase(tx, it.productId, it.unitName, it.qty);
      out.push({
        productId: it.productId, unitName: it.unitName, qty: new D(it.qty), qtyBase, factor,
        unitPrice: new D(it.unitPrice), lineTotal: this.stock.money(new D(it.qty).mul(it.unitPrice)),
      });
    }
    return out;
  }

  private async recordPayment(tx: Tx, p: { supplierId: string; amount: Prisma.Decimal; method?: string; date: Date; note?: string; userId: string }) {
    const paymentNo = await this.stock.nextNo(tx, 'SUPPLIER_PAYMENT', 'SP');
    const payment = await tx.supplierPayment.create({
      data: { paymentNo, supplierId: p.supplierId, amount: p.amount, method: p.method ?? 'CASH', date: p.date, note: p.note, createdById: p.userId },
    });
    await tx.supplierLedger.create({
      data: { supplierId: p.supplierId, date: p.date, amount: p.amount.neg(), refType: 'PAYMENT', refId: payment.id, createdById: p.userId, note: paymentNo },
    });
    return payment;
  }
}

@Module({ controllers: [PurchasingController] })
export class PurchasingModule {}
