/** Numbers the way the shop reads them: Pakistani grouping, no currency noise. */

const n = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? 0 : Number(v));

/** Money with up to 2 decimals: 1,350 · 1,350.5 · 95.25 */
export const money = (v: string | number | null | undefined) => n(v).toLocaleString('en-PK', { maximumFractionDigits: 2 });

/** Whole rupees for totals, tiles and reports: 72,450 */
export const rupees = (v: string | number | null | undefined) => n(v).toLocaleString('en-PK', { maximumFractionDigits: 0 });

/** "Rs 1,350" */
export const rs = (v: string | number | null | undefined) => `Rs ${money(v)}`;

/** Round to paisa, the precision every bill is stored in. */
export const round2 = (v: number) => Math.round(v * 100) / 100;

/** "36 (6 ctn)" for bottles that come in cartons, "50 kg" for rice, plain number otherwise. */
export function formatQty(qtyBase: string | number, units: { unitName: string; factorToBase: string | number }[], baseUnit: string) {
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
