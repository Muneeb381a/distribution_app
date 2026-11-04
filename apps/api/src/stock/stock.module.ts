import { BadRequestException, Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { MovementType, Prisma, StockStatus, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { StockService } from './stock.service.js';

class TransferItemDto {
  @IsUUID() productId: string;
  @IsEnum(UnitName) unitName: UnitName;
  @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() qty: number;
}

class TransferDto {
  @IsUUID() fromLocationId: string;
  @IsUUID() toLocationId: string;
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => TransferItemDto) items: TransferItemDto[];
}

const ADJUST_KINDS = ['ADD', 'REMOVE', 'MARK_DAMAGED', 'RESTORE_DAMAGED', 'WRITE_OFF_DAMAGED'] as const;
type AdjustKind = (typeof ADJUST_KINDS)[number];

class AdjustDto {
  @IsUUID() locationId: string;
  @IsUUID() productId: string;
  @IsEnum(UnitName) unitName: UnitName;
  @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() qty: number;
  @IsEnum(ADJUST_KINDS) kind: AdjustKind;
  @IsString() @MinLength(3) note: string;
}

interface StockQuery {
  locationId?: string;
  productId?: string;
  line?: 'BOTTLES' | 'RICE';
  search?: string;
}

/** Local-time [start, end) for a range of days ("2026-11-01" to "2026-11-30"); defaults to the last 30 days. */
function localRange(from?: string, to?: string) {
  const day = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const valid = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const end = valid(to) ? day(to!) : new Date(new Date().setHours(0, 0, 0, 0));
  end.setDate(end.getDate() + 1);
  const start = valid(from) ? day(from!) : new Date(end.getTime() - 30 * 86_400_000);
  if (start >= end) throw new BadRequestException('"to" is before "from"');
  return { start, end };
}

@Controller('stock')
class StockController {
  constructor(private prisma: PrismaService, private stock: StockService, private audit: AuditService) {}

  /** On-hand per product and location. Cost and value are only included for users who can view reports. */
  @Get()
  async onHand(@Query() q: StockQuery, @CurrentUser() user: AuthUser) {
    const productWhere: Prisma.ProductWhereInput = {
      id: q.productId,
      category: q.line ? { businessLine: { code: q.line } } : undefined,
      name: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
    };
    const groups = await this.prisma.stockMovement.groupBy({
      by: ['productId', 'locationId', 'status'],
      where: { locationId: q.locationId, product: productWhere },
      _sum: { qtyBase: true },
    });
    const [products, locations] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: [...new Set(groups.map((g) => g.productId))] } },
        include: { units: true, cost: true, category: { select: { businessLine: { select: { code: true } } } } },
      }),
      this.prisma.location.findMany(),
    ]);
    const showCost = user.permissions.includes('REPORT_VIEW');
    const rows = new Map<string, Record<string, unknown>>();
    for (const g of groups) {
      const key = `${g.productId}|${g.locationId}`;
      const p = products.find((x) => x.id === g.productId)!;
      const row =
        rows.get(key) ??
        {
          productId: p.id,
          productName: p.name,
          size: p.size,
          line: p.category.businessLine.code,
          baseUnit: p.baseUnit,
          units: p.units.map((u) => ({ unitName: u.unitName, factorToBase: u.factorToBase })),
          locationId: g.locationId,
          locationName: locations.find((l) => l.id === g.locationId)?.name,
          ok: new Prisma.Decimal(0),
          damaged: new Prisma.Decimal(0),
          ...(showCost ? { latestUnitCost: p.cost?.latestUnitCostBase ?? null } : {}),
        };
      const qty = g._sum.qtyBase ?? new Prisma.Decimal(0);
      if (g.status === 'OK') row.ok = qty;
      else row.damaged = qty;
      rows.set(key, row);
    }
    const out = [...rows.values()].filter((r) => !(r.ok as Prisma.Decimal).isZero() || !(r.damaged as Prisma.Decimal).isZero());
    if (showCost) {
      for (const r of out) {
        const cost = r.latestUnitCost as Prisma.Decimal | null;
        r.value = cost ? this.stock.money((r.ok as Prisma.Decimal).mul(cost)) : null;
      }
    }
    return out.sort((a, b) => String(a.productName).localeCompare(String(b.productName)) || String(a.locationName).localeCompare(String(b.locationName)));
  }

  @Get('movements')
  movements(@Query('productId') productId?: string, @Query('locationId') locationId?: string, @Query('limit') limit = '200') {
    return this.prisma.stockMovement.findMany({
      where: { productId, locationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 200, 1000),
      include: { product: { select: { name: true, size: true } }, location: { select: { name: true } } },
    });
  }

  /**
   * Stock history. With a product it is a stock card: saleable and damaged stock before the range,
   * then each movement with the stock after it (for one location, or all together). Without a product
   * it is the latest movements across the business. Each row names its document and who made it.
   */
  @Get('history')
  async history(@Query() q: { productId?: string; locationId?: string; type?: string; from?: string; to?: string }) {
    const { start, end } = localRange(q.from, q.to);
    const types = q.type ? (q.type.split(',').filter((t) => t in MovementType) as MovementType[]) : undefined;
    const where: Prisma.StockMovementWhereInput = { productId: q.productId || undefined, locationId: q.locationId || undefined };
    const [rows, before] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where: { ...where, createdAt: { gte: start, lt: end }, type: types ? { in: types } : undefined },
        orderBy: { createdAt: q.productId ? 'asc' : 'desc' },
        take: 1000,
        include: { product: { select: { id: true, name: true, size: true, baseUnit: true } }, location: { select: { id: true, name: true } } },
      }),
      q.productId
        ? this.prisma.stockMovement.groupBy({ by: ['status'], where: { ...where, createdAt: { lt: start } }, _sum: { qtyBase: true } })
        : Promise.resolve([]),
    ]);

    // Document numbers for the refs, and who made each movement.
    const ids = (t: string) => [...new Set(rows.filter((r) => r.refType === t && r.refId).map((r) => r.refId!))];
    const [sales, purchases, returns, transfers, users, trips] = await Promise.all([
      this.prisma.sale.findMany({ where: { id: { in: ids('SALE') } }, select: { id: true, billNo: true, customer: { select: { name: true } } } }),
      this.prisma.purchase.findMany({ where: { id: { in: ids('PURCHASE') } }, select: { id: true, purchaseNo: true, supplier: { select: { name: true } } } }),
      this.prisma.purchaseReturn.findMany({ where: { id: { in: ids('PURCHASE_RETURN') } }, select: { id: true, returnNo: true, supplier: { select: { name: true } } } }),
      this.prisma.stockTransfer.findMany({ where: { id: { in: ids('TRANSFER') } }, select: { id: true, transferNo: true, from: { select: { name: true } }, to: { select: { name: true } } } }),
      this.prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, username: true } }),
      this.prisma.vehicleTrip.findMany({ where: { id: { in: ids('TRIP') } }, select: { id: true, tripNo: true, vehicle: { select: { name: true } } } }),
    ]);
    const docOf = (r: (typeof rows)[number]) => {
      if (r.refType === 'SALE') { const x = sales.find((s) => s.id === r.refId); return x && { no: x.billNo, party: x.customer?.name ?? 'Walk-in', link: `/sales/${x.id}` }; }
      if (r.refType === 'PURCHASE') { const x = purchases.find((s) => s.id === r.refId); return x && { no: x.purchaseNo, party: x.supplier.name, link: '/purchases' }; }
      if (r.refType === 'PURCHASE_RETURN') { const x = returns.find((s) => s.id === r.refId); return x && { no: x.returnNo, party: x.supplier.name, link: '/purchases' }; }
      if (r.refType === 'TRANSFER') { const x = transfers.find((s) => s.id === r.refId); return x && { no: x.transferNo, party: `${x.from.name} → ${x.to.name}`, link: '/stock' }; }
      if (r.refType === 'TRIP') { const x = trips.find((s) => s.id === r.refId); return x && { no: x.tripNo, party: x.vehicle.name, link: `/trips/${x.id}` }; }
      return null;
    };

    const sum = (st: StockStatus) => before.find((b) => b.status === st)?._sum.qtyBase ?? new Prisma.Decimal(0);
    let ok = sum('OK');
    let damaged = sum('DAMAGED');
    const opening = { ok, damaged };
    const out = rows.map((r) => {
      if (r.status === 'OK') ok = ok.plus(r.qtyBase); else damaged = damaged.plus(r.qtyBase);
      return {
        id: r.id, at: r.createdAt, type: r.type, status: r.status, qtyBase: r.qtyBase, note: r.note,
        product: r.product, location: r.location, doc: docOf(r) ?? null,
        by: users.find((u) => u.id === r.createdById)?.username ?? null,
        ...(q.productId ? { okAfter: ok, damagedAfter: damaged } : {}),
      };
    });
    return {
      from: q.from ?? null, to: q.to ?? null, truncated: rows.length === 1000,
      ...(q.productId ? { opening, closing: { ok, damaged } } : {}),
      rows: out,
    };
  }

  @Get('transfers')
  transfers() {
    return this.prisma.stockTransfer.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { from: { select: { name: true } }, to: { select: { name: true } }, items: { include: { product: { select: { name: true } } } } },
    });
  }

  @Post('transfers') @RequirePermissions('STOCK_TRANSFER')
  async transfer(@Body() dto: TransferDto, @CurrentUser() user: AuthUser) {
    const result = await this.prisma.$transaction((tx) => this.stock.transfer(tx, { ...dto, userId: user.id }));
    await this.audit.log(user.id, 'CREATE', 'StockTransfer', result.id, undefined, result);
    return result;
  }


  /** Manual corrections and the damaged-stock workflow. Every one needs a note and is audited. */
  @Post('adjustments') @RequirePermissions('STOCK_ADJUST')
  async adjust(@Body() dto: AdjustDto, @CurrentUser() user: AuthUser) {
    if (dto.kind === 'RESTORE_DAMAGED' && !user.permissions.includes('DAMAGED_APPROVE')) {
      throw new BadRequestException('Returning damaged stock to saleable stock needs the DAMAGED_APPROVE permission');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.stock.requireLocation(tx, dto.locationId);
      await this.stock.requireProduct(tx, dto.productId);
      const { qtyBase } = await this.stock.toBase(tx, dto.productId, dto.unitName, dto.qty);
      const base = { productId: dto.productId, locationId: dto.locationId, userId: user.id, note: dto.note, refType: 'ADJUSTMENT' };
      const pair = (from: StockStatus, to: StockStatus, type: 'DAMAGE_MARK' | 'DAMAGE_RESTORE') =>
        this.stock.move(tx, { ...base, qtyBase: qtyBase.neg(), status: from, type }).then(() => this.stock.move(tx, { ...base, qtyBase, status: to, type }));
      switch (dto.kind) {
        case 'ADD':
          return this.stock.move(tx, { ...base, qtyBase, type: 'ADJUST' });
        case 'REMOVE':
          return this.stock.move(tx, { ...base, qtyBase: qtyBase.neg(), type: 'ADJUST' });
        case 'MARK_DAMAGED':
          return pair('OK', 'DAMAGED', 'DAMAGE_MARK');
        case 'RESTORE_DAMAGED':
          return pair('DAMAGED', 'OK', 'DAMAGE_RESTORE');
        case 'WRITE_OFF_DAMAGED':
          return this.stock.move(tx, { ...base, qtyBase: qtyBase.neg(), status: 'DAMAGED', type: 'WRITE_OFF' });
      }
    });
    await this.audit.log(user.id, `STOCK_${dto.kind}`, 'Product', dto.productId, undefined, dto);
    return { ok: true };
  }
}

@Module({ controllers: [StockController] })
export class StockModule {}
