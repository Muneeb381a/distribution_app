import type { BusinessLineCode, Prisma } from '@prisma/client';
import { productKey, type ProductSpec } from '@dist/shared';

/**
 * Creates products (and any missing categories along their path) in one transaction.
 * Used by the Excel import and by "add from catalog". Products that already exist
 * (same name and size) are skipped, so running it twice is harmless.
 */
export async function createProducts(tx: Prisma.TransactionClient, specs: ProductSpec[]) {
  const lines = new Map((await tx.businessLine.findMany()).map((l) => [l.code, l.id]));
  const existing = new Set((await tx.product.findMany({ select: { name: true, size: true } })).map((p) => productKey(p.name, p.size)));
  const cache = new Map<string, string>();
  const categoryId = async (code: BusinessLineCode, path: string[]) => {
    let parentId: string | null = null;
    let key = code as string;
    for (const name of path) {
      key += `/${name}`;
      let id: string | undefined = cache.get(key);
      if (!id) {
        const where: { businessLineId: string; parentId: string | null; name: string } = { businessLineId: lines.get(code)!, parentId, name };
        const found: { id: string } | null = await tx.category.findFirst({ where });
        id = found?.id ?? (await tx.category.create({ data: where })).id;
        cache.set(key, id);
      }
      parentId = id;
    }
    return parentId!;
  };

  const created: { id: string; name: string; size: string | null }[] = [];
  const skipped: { name: string; size: string | null }[] = [];
  for (const d of specs) {
    const k = productKey(d.name, d.size);
    if (existing.has(k)) {
      skipped.push({ name: d.name, size: d.size });
      continue;
    }
    existing.add(k);
    const bottles = d.line === 'BOTTLES';
    const p = await tx.product.create({
      data: {
        categoryId: await categoryId(d.line, d.path),
        name: d.name,
        brand: d.brand,
        size: d.size,
        baseUnit: bottles ? 'BOTTLE' : 'KG',
        isPacked: d.isPacked ?? (!bottles && d.bagKg != null),
        returnableEmpty: bottles && d.returnableEmpty,
        units: {
          create: bottles
            ? [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: d.packSize }]
            : d.isPacked
              ? [{ unitName: 'KG', factorToBase: 1 }, { unitName: 'BAG', factorToBase: d.bagKg! }]
              : [
                  { unitName: 'KG', factorToBase: 1 },
                  { unitName: 'MAUND', factorToBase: 40 },
                  ...(d.bagKg != null ? [{ unitName: 'BAG' as const, factorToBase: d.bagKg }] : []),
                ],
        },
      },
      select: { id: true, name: true, size: true },
    });
    created.push(p);
  }
  return { created, skipped };
}
