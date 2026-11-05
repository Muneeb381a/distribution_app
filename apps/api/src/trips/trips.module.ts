import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsEnum, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Prisma, UnitName } from '@prisma/client';
import { PrismaService } from '../prisma.service.js';
import { AuditService } from '../audit/audit.module.js';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/decorators.js';
import { dayOf } from '../common/dates.js';
import { StockService, type Tx } from '../stock/stock.service.js';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

class LoadItemDto {
  @IsUUID() productId: string;
  @IsEnum(UnitName) unitName: UnitName;
  @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() qty: number;
}

class OpenTripDto {
  @IsUUID() vehicleId: string;
  @IsOptional() @IsUUID() salesmanId?: string;
  /** Where the morning load comes from (usually the godown). */
  @IsOptional() @IsUUID() fromLocationId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LoadItemDto) items?: LoadItemDto[];
  @IsOptional() @IsISO8601() date?: string;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

class LoadDto {
  @IsUUID() fromLocationId: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => LoadItemDto) items: LoadItemDto[];
}

class CountDto {
  @IsUUID() productId: string;
  /** Counted on the vehicle, in base units (bottles / kg). */
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) counted: number;
}

class SettleDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => CountDto) lines: CountDto[];
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cashReceived: number;
  /** Unload what was counted back to this location (usually the godown). */
  @IsOptional() @IsUUID() unloadToLocationId?: string;
  /** Record a cash shortage as a salary advance to the salesman (needs PAYROLL_MANAGE). */
  @IsOptional() @IsBoolean() shortageAsAdvance?: boolean;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
}

type Line = { productId: string; name: string; size: string | null; baseUnit: string; units: { unitName: string; factorToBase: Dec }[]; atStart: Dec; loaded: Dec; sold: Dec; other: Dec; expected: Dec; damaged: Dec };

@Controller('trips')
class TripsController {
  constructor(private prisma: PrismaService, private stock: StockService, private audit: AuditService) {}

  @Get() @RequirePermissions('STOCK_TRANSFER')
  async list(@Query('status') status?: string, @Query('vehicleId') vehicleId?: string) {
    return this.prisma.vehicleTrip.findMany({
      where: { status: status === 'OPEN' || status === 'SETTLED' ? status : undefined, vehicleId: vehicleId || undefined },
      orderBy: [{ status: 'asc' }, { openedAt: 'desc' }],
      take: 200,
      include: { vehicle: { select: { id: true, name: true } }, salesman: { select: { id: true, name: true } }, lines: { select: { diff: true } } },
    });
  }

  /** A trip with its live position: what was loaded and sold per product, what should be on board, and the cash. */
  @Get(':id') @RequirePermissions('STOCK_TRANSFER')
  async get(@Param('id') id: string) {
    return this.summary(this.prisma, id);
  }

  /** Start the day: open a trip for the vehicle and load it from the godown in one transfer. */
  @Post() @RequirePermissions('STOCK_TRANSFER')
  async open(@Body() dto: OpenTripDto, @CurrentUser() u: AuthUser) {
    const trip = await this.prisma.$transaction(async (tx) => {
      await this.stock.requireLocation(tx, dto.vehicleId, ['VEHICLE']);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trip:' + dto.vehicleId}))`;
      const open = await tx.vehicleTrip.findFirst({ where: { vehicleId: dto.vehicleId, status: 'OPEN' } });
      if (open) throw new ConflictException(`${open.tripNo} is still open for this vehicle; settle it first`);
      if (dto.salesmanId) {
        const e = await tx.employee.findUnique({ where: { id: dto.salesmanId } });
        if (!e?.isActive) throw new BadRequestException('Unknown or inactive salesman');
      }
      if (dto.items?.length && !dto.fromLocationId) throw new BadRequestException('Say where the load comes from');
      const tripNo = await this.stock.nextNo(tx, 'TRIP', 'TR');
      const trip = await tx.vehicleTrip.create({
        data: { tripNo, vehicleId: dto.vehicleId, salesmanId: dto.salesmanId, date: dayOf(dto.date), note: dto.note, openedById: u.id },
      });
      if (dto.items?.length) {
        await this.stock.transfer(tx, { fromLocationId: dto.fromLocationId!, toLocationId: dto.vehicleId, items: dto.items, note: `Load ${tripNo}`, userId: u.id, date: dto.date });
      }
      return trip;
    });
    await this.audit.log(u.id, 'CREATE', 'VehicleTrip', trip.id, undefined, trip);
    return this.summary(this.prisma, trip.id);
  }

  /** Load more during the day (a second round from the godown). */
  @Post(':id/load') @RequirePermissions('STOCK_TRANSFER')
  async load(@Param('id') id: string, @Body() dto: LoadDto, @CurrentUser() u: AuthUser) {
    if (!dto.items.length) throw new BadRequestException('Add at least one item');
    await this.prisma.$transaction(async (tx) => {
      const trip = await this.openTrip(tx, id);
      await this.stock.transfer(tx, { fromLocationId: dto.fromLocationId, toLocationId: trip.vehicleId, items: dto.items, note: `Load ${trip.tripNo}`, userId: u.id });
    });
    await this.audit.log(u.id, 'LOAD', 'VehicleTrip', id, undefined, dto);
    return this.summary(this.prisma, id);
  }

  /**
   * End of day: the counted stock replaces what the books expected (shortage or extra posted as an
   * adjustment), the counted stock is unloaded if asked, and the cash handed over is compared with the
   * cash taken on the trip's bills. A cash shortage can become a salary advance to the salesman.
   */
  @Post(':id/settle') @RequirePermissions('STOCK_ADJUST')
  async settle(@Param('id') id: string, @Body() dto: SettleDto, @CurrentUser() u: AuthUser) {
    if (dto.shortageAsAdvance && !u.permissions.includes('PAYROLL_MANAGE')) throw new ForbiddenException('Recording a shortage as an advance needs the payroll permission');
    const result = await this.prisma.$transaction(async (tx) => {
      const trip = await this.openTrip(tx, id);
      const s = await this.summary(tx, id);
      const counted = new Map(dto.lines.map((l) => [l.productId, new D(l.counted)]));
      for (const pid of counted.keys()) if (!s.lines.some((l) => l.productId === pid)) throw new BadRequestException('A counted product was not on this vehicle');
      const missing = s.lines.filter((l) => !counted.has(l.productId) && !l.expected.isZero());
      if (missing.length) throw new BadRequestException(`Count every product on the vehicle: ${missing.map((m) => m.name).join(', ')} not counted`);

      const ref = { refType: 'TRIP', refId: trip.id, userId: u.id };
      const rows = [];
      for (const l of s.lines) {
        const c = counted.get(l.productId) ?? new D(0);
        const diff = c.minus(l.expected);
        if (!diff.isZero()) {
          await this.stock.move(tx, {
            ...ref, productId: l.productId, locationId: trip.vehicleId, qtyBase: diff, type: 'ADJUST',
            note: `${diff.isNegative() ? 'Short' : 'Extra'} at settlement of ${trip.tripNo}`,
          });
        }
        rows.push({ tripId: trip.id, productId: l.productId, loaded: l.loaded, sold: l.sold, expected: l.expected, counted: c, diff, unloaded: dto.unloadToLocationId ? c : new D(0) });
      }
      if (dto.unloadToLocationId) {
        const back = rows.filter((r) => r.counted.gt(0)).map((r) => ({ productId: r.productId, unitName: s.lines.find((l) => l.productId === r.productId)!.baseUnit as UnitName, qty: r.counted.toNumber() }));
        if (back.length) await this.stock.transfer(tx, { fromLocationId: trip.vehicleId, toLocationId: dto.unloadToLocationId, items: back, note: `Unload ${trip.tripNo}`, userId: u.id });
      }
      if (rows.length) await tx.vehicleTripLine.createMany({ data: rows });

      const short = s.cash.expected.minus(dto.cashReceived);
      let advanceId: string | null = null;
      if (dto.shortageAsAdvance && short.gt(0)) {
        if (!trip.salesmanId) throw new BadRequestException('This trip has no salesman to give the shortage to');
        const adv = await tx.salaryAdvance.create({
          data: { employeeId: trip.salesmanId, amount: short, date: dayOf(), note: `Cash short on ${trip.tripNo}`, createdById: u.id },
        });
        advanceId = adv.id;
      }
      return tx.vehicleTrip.update({
        where: { id },
        data: { status: 'SETTLED', settledAt: new Date(), settledById: u.id, cashExpected: s.cash.expected, cashReceived: dto.cashReceived, advanceId, note: dto.note ?? trip.note },
      });
    }, { timeout: 30_000 });
    await this.audit.log(u.id, 'SETTLE', 'VehicleTrip', id, undefined, result);
    return this.summary(this.prisma, id);
  }

  private async openTrip(tx: Tx, id: string) {
    const trip = await tx.vehicleTrip.findUnique({ where: { id } });
    if (!trip) throw new NotFoundException();
    if (trip.status !== 'OPEN') throw new ConflictException(`${trip.tripNo} is already settled`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'trip:' + trip.vehicleId}))`;
    return trip;
  }

  private async summary(db: Tx | PrismaService, id: string) {
    const trip = await db.vehicleTrip.findUnique({
      where: { id },
      include: {
        vehicle: { select: { id: true, name: true } }, salesman: { select: { id: true, name: true } },
        lines: { include: { product: { select: { name: true, size: true } } } },
      },
    });
    if (!trip) throw new NotFoundException();
    const until = trip.settledAt ?? new Date();
    const during = { gte: trip.openedAt, lte: until };
    const [before, moves, sales, advance] = await Promise.all([
      db.stockMovement.groupBy({ by: ['productId'], where: { locationId: trip.vehicleId, status: 'OK', createdAt: { lt: trip.openedAt } }, _sum: { qtyBase: true } }),
      db.stockMovement.findMany({ where: { locationId: trip.vehicleId, createdAt: during, refType: { not: 'TRIP' } }, select: { productId: true, qtyBase: true, type: true, status: true, note: true } }),
      db.sale.findMany({
        where: { OR: [{ locationId: trip.vehicleId }, { vehicleId: trip.vehicleId }], status: 'ACTIVE', createdAt: during },
        orderBy: { createdAt: 'asc' },
        select: { id: true, billNo: true, net: true, paidNow: true, createdAt: true, customer: { select: { id: true, name: true } }, payments: { where: { status: 'ACTIVE' }, select: { amount: true, method: true } } },
      }),
      trip.advanceId ? db.salaryAdvance.findUnique({ where: { id: trip.advanceId }, select: { id: true, amount: true } }) : Promise.resolve(null),
    ]);
    // The unload at settlement is a transfer out after the count; it is not part of what the trip used.
    const unloadNote = `Unload ${trip.tripNo}`;
    const ids = [...new Set([...before.map((b) => b.productId), ...moves.map((m) => m.productId), ...trip.lines.map((l) => l.productId)])];
    const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, size: true, baseUnit: true, units: { select: { unitName: true, factorToBase: true } } } });
    const lines: Line[] = ids.map((pid) => {
      const p = products.find((x) => x.id === pid)!;
      const atStart = before.find((b) => b.productId === pid)?._sum.qtyBase ?? new D(0);
      let loaded = new D(0), sold = new D(0), other = new D(0), damaged = new D(0);
      for (const m of moves.filter((x) => x.productId === pid)) {
        if (m.status !== 'OK') { damaged = damaged.plus(m.qtyBase); continue; }
        if (m.type === 'TRANSFER_OUT' && m.note === unloadNote) continue;
        if (m.type === 'TRANSFER_IN') loaded = loaded.plus(m.qtyBase);
        else if (m.type === 'SALE' || m.type === 'SALE_CANCEL') sold = sold.minus(m.qtyBase);
        else other = other.plus(m.qtyBase);
      }
      return { productId: pid, name: p.name, size: p.size, baseUnit: p.baseUnit, units: p.units, atStart, loaded, sold, other, expected: atStart.plus(loaded).minus(sold).plus(other), damaged };
    }).filter((l) => !(l.atStart.isZero() && l.loaded.isZero() && l.sold.isZero() && l.other.isZero() && l.damaged.isZero()))
      .sort((a, b) => a.name.localeCompare(b.name));

    const byMethod: Record<string, Dec> = {};
    let net = new D(0), paid = new D(0);
    for (const s of sales) {
      net = net.plus(s.net);
      paid = paid.plus(s.paidNow);
      for (const p of s.payments) byMethod[p.method] = (byMethod[p.method] ?? new D(0)).plus(p.amount);
    }
    const expected = trip.status === 'SETTLED' && trip.cashExpected ? trip.cashExpected : (byMethod.CASH ?? new D(0));
    return {
      ...trip,
      lines,
      settledLines: trip.lines,
      sales,
      totals: { bills: sales.length, net, paid, udhaar: net.minus(paid) },
      cash: { expected, byMethod, received: trip.cashReceived, short: trip.cashReceived ? expected.minus(trip.cashReceived) : null },
      advance,
    };
  }
}

@Module({ controllers: [TripsController] })
export class TripsModule {}
