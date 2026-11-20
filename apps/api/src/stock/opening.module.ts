import { randomUUID } from 'node:crypto';
import { BadRequestException, Body, ConflictException, Controller, Get, Module, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { StockService } from './stock.service.js';

const D = Prisma.Decimal;

class OpeningLineDto {
  @IsUUID() productId: string;
  /** How much of the product is in the place, in base units (bottles or kg). A recount sends the new total. */
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100_000_000) qtyBase: number;
  /** What a base unit cost; left out when the cost is not known or not changing. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @IsPositive() @Max(10_000_000) unitCostBase?: number;
}

class OpeningDto {
  @IsUUID() locationId: string;
  /** The day the stock is counted as of; today when left out. */
  @IsOptional() @IsISO8601() asOf?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => OpeningLineDto) lines: OpeningLineDto[];
}

class CostItemDto {
  @IsUUID() productId: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @IsPositive() @Max(10_000_000) unitCostBase: number;
}

class CostsDto {
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CostItemDto) items: CostItemDto[];
}

/** Local midnight of a day typed as 2026-11-01, so history shows the stock from that day. */
function localMidnight(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

@Controller('stock')
class OpeningController {
  constructor(private prisma: PrismaService, private stock: StockService, private audit: AuditService) {}

  /**
   * Everything the opening-stock screen needs for one place: every active product with its units, what is already
   * recorded as opening stock here, what is on hand, and its cost, so a recount starts from what was entered before.
   */
  @Get('opening/sheet') @RequirePermissions('STOCK_ADJUST')
  async sheet(@Query('locationId') locationId: string) {
    if (!locationId) throw new BadRequestException('Choose a godown or shop');
    const loc = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!loc || !loc.isActive || loc.type === 'VEHICLE') throw new BadRequestException('Choose a godown or shop');
    const [products, cats, opened, held] = await Promise.all([
      this.prisma.product.findMany({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }, { size: 'asc' }],
        select: { id: true, name: true, size: true, brand: true, categoryId: true, baseUnit: true, isPacked: true, units: { select: { unitName: true, factorToBase: true } }, cost: { select: { latestUnitCostBase: true } } },
      }),
      this.prisma.category.findMany({ select: { id: true, name: true, parentId: true, businessLine: { select: { code: true } } } }),
      this.prisma.stockMovement.groupBy({ by: ['productId'], where: { locationId, type: 'OPENING', status: 'OK' }, _sum: { qtyBase: true } }),
      this.prisma.stockMovement.groupBy({ by: ['productId'], where: { locationId, status: 'OK' }, _sum: { qtyBase: true } }),
    ]);
    const byId = new Map(cats.map((c) => [c.id, c]));
    const top = (id: string) => { let c = byId.get(id); while (c?.parentId) c = byId.get(c.parentId); return c; };
    return {
      location: { id: loc.id, name: loc.name, type: loc.type },
      rows: products.map(({ id, cost, categoryId, ...p }) => {
        const leaf = byId.get(categoryId);
        return {
          productId: id,
          ...p,
          line: leaf?.businessLine.code ?? null,
          group: top(categoryId)?.name ?? '',
          category: leaf?.name ?? '',
          recorded: opened.find((o) => o.productId === id)?._sum.qtyBase ?? new D(0),
          onHand: held.find((o) => o.productId === id)?._sum.qtyBase ?? new D(0),
          cost: cost?.latestUnitCostBase ?? null,
        };
      }),
    };
  }

  /**
   * Enter the stock the shop already has. Each line is the total in this place: the first time it becomes the opening
   * stock; counting again posts only the difference. Nothing is owed to anyone, so no supplier is involved.
   */
  @Post('opening') @RequirePermissions('STOCK_ADJUST')
  async save(@Body() dto: OpeningDto, @CurrentUser() u: AuthUser) {
    const today = dayOf();
    const asOf = dto.asOf ? dayOf(dto.asOf) : today;
    if (asOf.getTime() > today.getTime()) throw new BadRequestException('The count date cannot be in the future');
    const at = dto.asOf && asOf.getTime() < today.getTime() ? localMidnight(dto.asOf) : undefined;
    const ids = dto.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A product is listed twice');

    const batch = await this.prisma.$transaction(async (tx) => {
      await this.stock.requireLocation(tx, dto.locationId, ['GODOWN', 'SHOP']);
      const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isActive: true } });
      for (const id of ids) {
        const p = products.find((x) => x.id === id);
        if (!p?.isActive) throw new BadRequestException('A product in the list is unknown or inactive');
      }
      const [opened, costs] = await Promise.all([
        tx.stockMovement.groupBy({ by: ['productId'], where: { locationId: dto.locationId, type: 'OPENING', status: 'OK', productId: { in: ids } }, _sum: { qtyBase: true } }),
        tx.productCost.findMany({ where: { productId: { in: ids } } }),
      ]);
      const id = randomUUID();
      const openingNo = await this.stock.nextNo(tx, 'OPENING', 'OS');
      const lines: Prisma.StockOpeningLineCreateManyOpeningInput[] = [];
      let value = new D(0);
      // Fixed order, so two people saving at once take their locks the same way.
      for (const l of [...dto.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const have = opened.find((o) => o.productId === l.productId)?._sum.qtyBase ?? new D(0);
        const delta = new D(l.qtyBase).minus(have);
        const existing = costs.find((c) => c.productId === l.productId)?.latestUnitCostBase ?? null;
        const typed = l.unitCostBase == null ? null : new D(l.unitCostBase);
        const costChanged = !!typed && !(existing && existing.equals(typed));
        if (delta.isZero() && !costChanged) continue;
        if (!delta.isZero()) {
          await this.stock.move(tx, { productId: l.productId, locationId: dto.locationId, qtyBase: delta, type: 'OPENING', refType: 'OPENING', refId: id, note: `Opening stock ${openingNo}`, userId: u.id, at });
        }
        if (costChanged) {
          await tx.productCost.upsert({ where: { productId: l.productId }, update: { latestUnitCostBase: typed! }, create: { productId: l.productId, latestUnitCostBase: typed! } });
        }
        value = value.plus(delta.mul(typed ?? existing ?? 0));
        lines.push({ productId: l.productId, qtyBase: delta, openingAfter: new D(l.qtyBase), unitCostBase: typed, previousCost: existing, costChanged });
      }
      if (!lines.length) throw new BadRequestException('Nothing to save: every quantity and cost is already as recorded');
      return tx.stockOpening.create({
        data: { id, openingNo, locationId: dto.locationId, asOf, note: dto.note?.trim() || null, totalValue: value.toDecimalPlaces(2), createdById: u.id, lines: { createMany: { data: lines } } },
        include: { lines: true },
      });
    }, { timeout: 30_000 });
    await this.audit.log(u.id, 'CREATE', 'StockOpening', batch.id, undefined, { openingNo: batch.openingNo, lines: batch.lines.length, totalValue: batch.totalValue });
    return batch;
  }

  @Get('openings') @RequirePermissions('STOCK_ADJUST')
  async list() {
    const rows = await this.prisma.stockOpening.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { location: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
    });
    const users = await this.prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, username: true } });
    // Only the newest live batch of a place can be reversed.
    const newest = new Map<string, string>();
    for (const r of rows) if (r.status === 'ACTIVE' && !newest.has(r.locationId)) newest.set(r.locationId, r.id);
    return rows.map(({ _count, ...r }) => ({ ...r, lineCount: _count.lines, by: users.find((x) => x.id === r.createdById)?.username ?? null, canReverse: newest.get(r.locationId) === r.id }));
  }

  @Get('openings/:id') @RequirePermissions('STOCK_ADJUST')
  async one(@Param('id') id: string) {
    const o = await this.prisma.stockOpening.findUnique({
      where: { id },
      include: {
        location: { select: { id: true, name: true } },
        lines: { include: { product: { select: { name: true, size: true, baseUnit: true, units: { select: { unitName: true, factorToBase: true } } } } } },
      },
    });
    if (!o) throw new NotFoundException();
    return { ...o, lines: o.lines.sort((a, b) => a.product.name.localeCompare(b.product.name)) };
  }

  /** Undo the newest save of a place (a typing mistake): its quantities come back off, and the costs it set go back. */
  @Post('openings/:id/reverse') @RequirePermissions('STOCK_ADJUST')
  async reverse(@Param('id') id: string, @CurrentUser() u: AuthUser) {
    const o = await this.prisma.stockOpening.findUnique({ where: { id }, include: { lines: true } });
    if (!o) throw new NotFoundException();
    if (o.status !== 'ACTIVE') throw new ConflictException(`${o.openingNo} was already reversed`);
    const later = await this.prisma.stockOpening.findFirst({ where: { locationId: o.locationId, status: 'ACTIVE', createdAt: { gt: o.createdAt } }, select: { openingNo: true } });
    if (later) throw new BadRequestException(`${later.openingNo} was saved after this one; reverse that first`);
    await this.prisma.$transaction(async (tx) => {
      for (const l of [...o.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
        if (!l.qtyBase.isZero()) {
          await this.stock.move(tx, { productId: l.productId, locationId: o.locationId, qtyBase: l.qtyBase.neg(), type: 'OPENING', refType: 'OPENING_REVERSAL', refId: o.id, note: `Reversal of ${o.openingNo}`, userId: u.id });
        }
        if (l.costChanged && l.unitCostBase) {
          // A cost set by a later purchase is left alone.
          const now = await tx.productCost.findUnique({ where: { productId: l.productId } });
          if (now?.latestUnitCostBase.equals(l.unitCostBase)) {
            if (l.previousCost) await tx.productCost.update({ where: { productId: l.productId }, data: { latestUnitCostBase: l.previousCost } });
            else await tx.productCost.delete({ where: { productId: l.productId } });
          }
        }
      }
      await tx.stockOpening.update({ where: { id }, data: { status: 'CANCELLED', reversedAt: new Date(), reversedById: u.id } });
    }, { timeout: 30_000 });
    await this.audit.log(u.id, 'REVERSE', 'StockOpening', id, { openingNo: o.openingNo }, undefined);
    return this.one(id);
  }

  /** Products that have stock but no cost, so their profit cannot be worked out until a cost is set. */
  @Get('opening/missing-costs') @RequirePermissions('STOCK_ADJUST')
  async missingCosts() {
    const held = await this.prisma.stockMovement.groupBy({ by: ['productId'], where: { status: 'OK' }, _sum: { qtyBase: true }, having: { qtyBase: { _sum: { gt: 0 } } } });
    const products = await this.prisma.product.findMany({
      where: { id: { in: held.map((h) => h.productId) }, isActive: true, cost: null },
      orderBy: [{ name: 'asc' }, { size: 'asc' }],
      select: { id: true, name: true, size: true, baseUnit: true, units: { select: { unitName: true, factorToBase: true } } },
    });
    return products.map((p) => ({ ...p, onHand: held.find((h) => h.productId === p.id)?._sum.qtyBase ?? new D(0) }));
  }

  /** Set the cost of products by hand (for stock that came with no purchase). */
  @Put('opening/costs') @RequirePermissions('STOCK_ADJUST')
  async setCosts(@Body() dto: CostsDto, @CurrentUser() u: AuthUser) {
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A product is listed twice');
    const found = await this.prisma.product.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('A product in the list is unknown');
    await this.prisma.$transaction(dto.items.map((i) => this.prisma.productCost.upsert({
      where: { productId: i.productId }, update: { latestUnitCostBase: i.unitCostBase }, create: { productId: i.productId, latestUnitCostBase: i.unitCostBase },
    })));
    await this.audit.log(u.id, 'SET_COSTS', 'Product', undefined, undefined, { count: dto.items.length });
    return { updated: dto.items.length };
  }
}

@Module({ controllers: [OpeningController] })
export class OpeningModule {}

