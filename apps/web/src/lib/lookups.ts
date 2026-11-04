import { useEffect, useState } from 'react';
import { lineLabel, productLabel } from '@dist/shared';
import { api } from './api';

export interface ProductOpt { id: string; name: string; size: string | null; baseUnit: string; returnableEmpty: boolean; category: { businessLine: { code: string } }; units: { unitName: string; factorToBase: string }[] }
export interface LocationOpt { id: string; name: string; type: string }
export interface SupplierOpt { id: string; name: string }

/** Products, locations and suppliers for dropdowns. */
export function useLookups() {
  const [data, setData] = useState<{ products: ProductOpt[]; locations: LocationOpt[]; suppliers: SupplierOpt[] }>({ products: [], locations: [], suppliers: [] });
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api<ProductOpt[]>('/products'), api<LocationOpt[]>('/locations'), api<SupplierOpt[]>('/suppliers')])
      .then(([products, locations, suppliers]) => setData({ products, locations, suppliers }))
      .catch((e) => setError(e.message));
  }, []);
  return { ...data, error };
}

// Labels and quantities come from @dist/shared so every screen shows them the same way.
export { productLabel, formatQty } from '@dist/shared';

/** Combobox options for products. */
export const productOptions = (products: ProductOpt[]) =>
  products.map((p) => ({
    value: p.id,
    label: productLabel(p),
    sub: lineLabel(p.category.businessLine.code),
  }));

export interface CustomerOpt { id: string; name: string; shopName: string | null; area: string | null; phone?: string | null; type: 'CASH' | 'CREDIT' }

/** Combobox options for customers: search by name, shop, area or phone. */
export const customerOptions = (customers: CustomerOpt[]) =>
  customers.map((c) => ({
    value: c.id,
    label: c.name,
    sub: [c.shopName, c.area].filter(Boolean).join(' · ') || undefined,
    keywords: c.phone ?? undefined,
    tag: c.type === 'CREDIT' ? 'Udhaar' : undefined,
  }));
