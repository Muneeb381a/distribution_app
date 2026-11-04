import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service.js';

/**
 * Active products whose saleable stock in all locations together is at or below their reorder level,
 * lowest first (by how much of the level is left), with where the stock is.
 */
export async function lowStock(db: PrismaService) {
  const watched = await db.product.findMany({
    where: { isActive: true, reorderLevel: { not: null } },
    select: { id: true, name: true, size: true, baseUnit: true, reorderLevel: true, units: { select: { unitName: true, factorToBase: true } }, category: { select: { businessLine: { select: { code: true } } } } },
  });
  if (!watched.length) return [];
  const [groups, locations] = await Promise.all([
    db.stockMovement.groupBy({ by: ['productId', 'locationId'], where: { status: 'OK', productId: { in: watched.map((p) => p.id) } }, _sum: { qtyBase: true } }),
    db.location.findMany({ select: { id: true, name: true } }),
  ]);
  return watched
    .map((p) => {
      const at = groups.filter((g) => g.productId === p.id && !(g._sum.qtyBase ?? new Prisma.Decimal(0)).isZero());
      const onHand = at.reduce((s, g) => s.plus(g._sum.qtyBase ?? 0), new Prisma.Decimal(0));
      return {
        productId: p.id, name: p.name, size: p.size, baseUnit: p.baseUnit, units: p.units, line: p.category.businessLine.code,
        reorderLevel: p.reorderLevel!, onHand,
        where: at.map((g) => ({ locationId: g.locationId, name: locations.find((l) => l.id === g.locationId)?.name ?? '', qtyBase: g._sum.qtyBase })),
      };
    })
    .filter((p) => p.onHand.lte(p.reorderLevel))
    .sort((a, b) => a.onHand.div(a.reorderLevel.isZero() ? 1 : a.reorderLevel).comparedTo(b.onHand.div(b.reorderLevel.isZero() ? 1 : b.reorderLevel)));
}
