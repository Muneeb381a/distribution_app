import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service.js';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const ZERO = () => new D(0);
const DAY = 86_400_000;

export type ReorderStatus = 'OUT' | 'URGENT' | 'SOON' | 'OK' | 'DEAD';

/**
 * What to buy, worked out from how fast each product really sells.
 *  - sells a day = base units sold over the last `days` days / days (cancelled bills left out);
 *  - days left   = stock now / sells a day;
 *  - to buy      = enough to cover `cover` days of selling, minus what is on hand, rounded up to whole cartons / bags
 *                  (the unit it was last bought in);
 *  - dead stock  = stock on hand with no sale for `deadDays` days.
 * Stock counts every location together, and only saleable stock (damaged is not stock you can sell).
 */
export async function reorderPlan(db: PrismaService, opts: { days: number; cover: number; deadDays?: number }) {
  const { days, cover } = opts;
  const deadDays = opts.deadDays ?? 60;
  const since = new Date(Date.now() - days * DAY);
  const [products, onHandRows, soldRows, lastSaleRows, lastBoughtRows] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, size: true, brand: true, baseUnit: true, reorderLevel: true,
        units: { select: { unitName: true, factorToBase: true } }, cost: { select: { latestUnitCostBase: true } },
        category: { select: { businessLine: { select: { code: true } } } },
      },
    }),
    db.stockMovement.groupBy({ by: ['productId'], where: { status: 'OK' }, _sum: { qtyBase: true } }),
    db.saleItem.groupBy({ by: ['productId'], where: { sale: { status: 'ACTIVE', date: { gte: since } } }, _sum: { qtyBase: true } }),
    db.saleItem.findMany({ where: { sale: { status: 'ACTIVE' } }, orderBy: { sale: { date: 'desc' } }, distinct: ['productId'], select: { productId: true, sale: { select: { date: true } } } }),
    db.purchaseItem.findMany({
      where: { purchase: { status: 'ACTIVE' } }, orderBy: { purchase: { date: 'desc' } }, distinct: ['productId'],
      select: { productId: true, unitName: true, unitPrice: true, purchase: { select: { date: true, supplier: { select: { id: true, name: true, phone: true } } } } },
    }),
  ]);

  const rows = products.map((p) => {
    const onHand = onHandRows.find((r) => r.productId === p.id)?._sum.qtyBase ?? ZERO();
    const sold = soldRows.find((r) => r.productId === p.id)?._sum.qtyBase ?? ZERO();
    const lastSale = lastSaleRows.find((r) => r.productId === p.id)?.sale.date ?? null;
    const bought = lastBoughtRows.find((r) => r.productId === p.id) ?? null;
    const perDay = sold.div(days);
    const daysLeft = perDay.gt(0) ? onHand.div(perDay) : null;

    // The unit to order in: the one it was last bought in, else the biggest pack.
    const biggest = [...p.units].sort((a, b) => b.factorToBase.comparedTo(a.factorToBase))[0];
    const unitName = bought?.unitName ?? biggest?.unitName ?? null;
    const factor = p.units.find((u) => u.unitName === unitName)?.factorToBase ?? new D(1);
    const need = perDay.mul(cover).minus(onHand);
    const buyUnits = need.gt(0) ? need.div(factor).ceil() : ZERO();

    const idle = lastSale ? Math.floor((Date.now() - lastSale.getTime()) / DAY) : null;
    let status: ReorderStatus = 'OK';
    if (onHand.gt(0) && perDay.isZero() && (idle === null || idle >= deadDays)) status = 'DEAD';
    else if (perDay.gt(0) && onHand.lte(0)) status = 'OUT';
    else if (daysLeft && daysLeft.lte(3)) status = 'URGENT';
    else if (daysLeft && daysLeft.lte(7)) status = 'SOON';

    const unitCost = p.cost?.latestUnitCostBase ?? null;
    return {
      productId: p.id, name: p.name, size: p.size, brand: p.brand, line: p.category.businessLine.code, baseUnit: p.baseUnit, units: p.units,
      onHand, perDay, daysLeft, status, soldInWindow: sold, lastSoldAt: lastSale, idleDays: idle, reorderLevel: p.reorderLevel,
      buy: buyUnits.gt(0) && perDay.gt(0) ? { unitName, units: buyUnits, baseQty: buyUnits.mul(factor), cost: unitCost ? buyUnits.mul(factor).mul(unitCost).toDecimalPlaces(0) : null } : null,
      stockValue: unitCost ? onHand.mul(unitCost).toDecimalPlaces(0) : null,
      lastBought: bought ? { unitName: bought.unitName, unitPrice: bought.unitPrice, date: bought.purchase.date, supplier: bought.purchase.supplier } : null,
    };
  });

  const order: Record<ReorderStatus, number> = { OUT: 0, URGENT: 1, SOON: 2, OK: 3, DEAD: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.daysLeft?.toNumber() ?? 1e9) - (b.daysLeft?.toNumber() ?? 1e9) || a.name.localeCompare(b.name));
  const sum = (xs: (Dec | null)[]) => xs.reduce<Dec>((t, x) => (x ? t.plus(x) : t), ZERO());
  const needed = rows.filter((r) => r.buy && (r.status === 'OUT' || r.status === 'URGENT' || r.status === 'SOON'));
  return {
    days, cover, deadDays,
    rows,
    totals: {
      out: rows.filter((r) => r.status === 'OUT').length,
      running: rows.filter((r) => r.status === 'URGENT' || r.status === 'SOON').length,
      dead: rows.filter((r) => r.status === 'DEAD').length,
      orderCost: sum(needed.map((r) => r.buy!.cost)),
      deadValue: sum(rows.filter((r) => r.status === 'DEAD').map((r) => r.stockValue)),
    },
  };
}
