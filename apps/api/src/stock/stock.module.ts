import { BadRequestException, Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';
import { Prisma, StockStatus, UnitName } from '@prisma/client';
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
    if (dto.fromLocationId === dto.toLocationId) throw new BadRequestException('Source and destination must differ');
    const result = await this.prisma.$transaction(async (tx) => {
      await this.stock.requireLocation(tx, dto.fromLocationId);
      await this.stock.requireLocation(tx, dto.toLocationId);
      const transferNo = await this.stock.nextNo(tx, 'TRANSFER', 'T');
      // Fixed order so concurrent transfers take their locks in the same order.
      const items = [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId));
      const rows = [];
      for (const it of items) {
        await this.stock.requireProduct(tx, it.productId);
        const { qtyBase } = await this.stock.toBase(tx, it.productId, it.unitName, it.qty);
        rows.push({ productId: it.productId, unitName: it.unitName, qty: it.qty, qtyBase });
      }
      const transfer = await tx.stockTransfer.create({
        data: { transferNo, fromLocationId: dto.fromLocationId, toLocationId: dto.toLocationId, date: dayOf(dto.date), note: dto.note, createdById: user.id, items: { create: rows } },
        include: { items: true },
      });
      for (const r of rows) {
        const ref = { refType: 'TRANSFER', refId: transfer.id, userId: user.id, productId: r.productId };
        await this.stock.move(tx, { ...ref, locationId: dto.fromLocationId, qtyBase: r.qtyBase.neg(), type: 'TRANSFER_OUT' });
        await this.stock.move(tx, { ...ref, locationId: dto.toLocationId, qtyBase: r.qtyBase, type: 'TRANSFER_IN' });
      }
      return transfer;
    });
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
