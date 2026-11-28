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

const grouped = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 3 });

/**
 * A stock quantity the way the shop talks about it: "36 (6 peti)" for bottles that come in cartons, and for rice both
 * the weight and the bags: "2,500 kg (50 bags)", "2,512 kg (50 bags + 12 kg)". Plain number otherwise.
 */
export function formatQty(qtyBase: string | number, units: { unitName: string; factorToBase: string | number }[], baseUnit: string) {
  const q = Number(qtyBase);
  const carton = units.find((u) => u.unitName === 'CARTON');
  if (baseUnit === 'BOTTLE' && carton && Number(carton.factorToBase) > 1) {
    const f = Number(carton.factorToBase);
    const c = Math.trunc(q / f);
    const r = q - c * f;
    return c ? `${q} (${c} peti${r ? ` + ${r}` : ''})` : String(q);
  }
  if (baseUnit === 'KG') {
    const bag = units.find((u) => u.unitName === 'BAG' && Number(u.factorToBase) > 1);
    if (bag && q > 0) {
      const f = Number(bag.factorToBase);
      const bags = Math.trunc(q / f);
      const rest = Math.round((q - bags * f) * 1000) / 1000;
      if (bags) return `${grouped(q)} kg (${bags} ${bags === 1 ? 'bag' : 'bags'}${rest ? ` + ${grouped(rest)} kg` : ''})`;
    }
    // loose rice sold by the maund and not by the bag: show the maunds
    const maund = units.find((u) => u.unitName === 'MAUND' && Number(u.factorToBase) > 1);
    if (!bag && maund && q > 0) return `${grouped(q)} kg (${grouped(Math.round((q / Number(maund.factorToBase)) * 100) / 100)} maund)`;
    return `${grouped(q)} kg`;
  }
  return String(q);
}

/** A Pakistani number as WhatsApp wants it: "0300-1234567" → "923001234567"; "" if there is none. */
export const waPhone = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '').replace(/^0/, '92');
