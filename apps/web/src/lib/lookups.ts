import { useEffect, useState } from 'react';
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

export const productLabel = (p: { name: string; size: string | null }) => (p.size ? `${p.name} (${p.size})` : p.name);

/** "36 (6 ctn)" for bottles, plain quantity otherwise. */
export function formatQty(qtyBase: string | number, units: { unitName: string; factorToBase: string }[], baseUnit: string) {
  const q = Number(qtyBase);
  const carton = units.find((u) => u.unitName === 'CARTON');
  if (baseUnit === 'BOTTLE' && carton && Number(carton.factorToBase) > 1) {
    const f = Number(carton.factorToBase);
    const c = Math.trunc(q / f);
    const r = q - c * f;
    return c ? `${q} (${c} ctn${r ? ` + ${r}` : ''})` : String(q);
  }
  return `${q}${baseUnit === 'KG' ? ' kg' : ''}`;
}
