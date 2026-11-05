import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';
import { MovementType, Prisma, StockStatus, UnitName } from '@prisma/client';
import { dayOf } from '../common/dates.js';
import { PrismaService } from '../prisma.service.js';

export type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;

export interface MoveInput {
  productId: string;
  locationId: string;
  /** Signed, in base units (bottles / kg). */
  qtyBase: Prisma.Decimal;
  status?: StockStatus;
  type: MovementType;
  refType?: string;
  refId?: string;
  note?: string;
  userId: string;
}

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  /** Rounds money to 2 decimals. */
  money(n: Prisma.Decimal.Value) {
    return new D(n).toDecimalPlaces(2);
  }

  /** Converts a quantity in any of the product's units to base units. */
  async toBase(tx: Tx, productId: string, unitName: UnitName, qty: number) {
    const unit = await tx.productUnit.findUnique({ where: { productId_unitName: { productId, unitName } } });
    if (!unit) throw new BadRequestException(`Product does not have unit ${unitName}`);
    return { qtyBase: new D(qty).mul(unit.factorToBase), factor: unit.factorToBase };
  }

  /**
   * Moves saleable stock between two locations as one numbered transfer document.
   * Items are in any unit of the product; returns the transfer with its items.
   */
  async transfer(tx: Tx, t: { fromLocationId: string; toLocationId: string; date?: string; note?: string; userId: string; items: { productId: string; unitName: UnitName; qty: number }[] }) {
    if (t.fromLocationId === t.toLocationId) throw new BadRequestException('Source and destination must differ');
    await this.requireLocation(tx, t.fromLocationId);
    await this.requireLocation(tx, t.toLocationId);
    const transferNo = await this.nextNo(tx, 'TRANSFER', 'T');
    // Fixed order so concurrent transfers take their locks in the same order.
    const items = [...t.items].sort((a, b) => a.productId.localeCompare(b.productId));
    const rows = [];
    for (const it of items) {
      await this.requireProduct(tx, it.productId);
      const { qtyBase } = await this.toBase(tx, it.productId, it.unitName, it.qty);
      rows.push({ productId: it.productId, unitName: it.unitName, qty: it.qty, qtyBase });
    }
    const transfer = await tx.stockTransfer.create({
      data: { transferNo, fromLocationId: t.fromLocationId, toLocationId: t.toLocationId, date: dayOf(t.date), note: t.note, createdById: t.userId, items: { create: rows } },
      include: { items: true },
    });
    for (const r of rows) {
      const ref = { refType: 'TRANSFER', refId: transfer.id, userId: t.userId, productId: r.productId, note: t.note };
      await this.move(tx, { ...ref, locationId: t.fromLocationId, qtyBase: r.qtyBase.neg(), type: 'TRANSFER_OUT' });
      await this.move(tx, { ...ref, locationId: t.toLocationId, qtyBase: r.qtyBase, type: 'TRANSFER_IN' });
    }
    return transfer;
  }

  async onHand(tx: Tx, productId: string, locationId: string, status: StockStatus = 'OK') {
    const r = await tx.stockMovement.aggregate({ where: { productId, locationId, status }, _sum: { qtyBase: true } });
    return r._sum.qtyBase ?? new D(0);
  }

  /**
   * Appends a stock movement. Removals are refused if they would make the location's stock negative.
   * An advisory lock per product+location serialises concurrent movements so two requests can't both
   * pass the check.
   */
  async move(tx: Tx, m: MoveInput) {
    if (m.qtyBase.isZero()) return;
    const status = m.status ?? 'OK';
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${m.productId + ':' + m.locationId}))`;
    if (m.qtyBase.isNegative()) {
      const have = await this.onHand(tx, m.productId, m.locationId, status);
      if (have.plus(m.qtyBase).isNegative()) {
        const product = await tx.product.findUnique({ where: { id: m.productId }, select: { name: true } });
        const where = await tx.location.findUnique({ where: { id: m.locationId }, select: { name: true } });
        throw new BadRequestException(
          `Not enough ${status === 'OK' ? '' : 'damaged '}stock of ${product?.name} at ${where?.name}: have ${have}, need ${m.qtyBase.neg()}`,
        );
      }
    }
    await tx.stockMovement.create({
      data: {
        productId: m.productId,
        locationId: m.locationId,
        qtyBase: m.qtyBase,
        status,
        type: m.type,
        refType: m.refType,
        refId: m.refId,
        note: m.note,
        createdById: m.userId,
      },
    });
  }

  /** Next document number, e.g. P-000007. Safe under concurrency (row lock on the counter). */
  async nextNo(tx: Tx, key: string, prefix: string) {
    const c = await tx.counter.upsert({ where: { key }, update: { value: { increment: 1 } }, create: { key, value: 1 } });
    return `${prefix}-${String(c.value).padStart(6, '0')}`;
  }

  async requireLocation(tx: Tx, id: string, allowed: ('GODOWN' | 'SHOP' | 'VEHICLE')[] = ['GODOWN', 'SHOP', 'VEHICLE']) {
    const loc = await tx.location.findUnique({ where: { id } });
    if (!loc || !loc.isActive) throw new BadRequestException('Unknown or inactive location');
    if (!allowed.includes(loc.type)) throw new BadRequestException(`${loc.name} is a ${loc.type.toLowerCase()}; not allowed here`);
    return loc;
  }

  async requireProduct(tx: Tx, id: string) {
    const p = await tx.product.findUnique({ where: { id } });
    if (!p || !p.isActive) throw new BadRequestException('Unknown or inactive product');
    return p;
  }
}

@Global()
@Module({ providers: [StockService], exports: [StockService] })
export class StockCoreModule {}
