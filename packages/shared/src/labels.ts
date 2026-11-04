/**
 * What the app calls things. Every list and badge reads from here, so a new payment method or a
 * renamed status is one edit.
 */

export type Tone = '' | 'green' | 'red' | 'amber' | 'blue' | 'teal';

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK', label: 'Bank' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'JAZZCASH', label: 'JazzCash' },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];
export const methodLabel = (m: string | null | undefined) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? (m ? m.charAt(0) + m.slice(1).toLowerCase() : '');

export const BUSINESS_LINES = [
  { value: 'BOTTLES', label: 'Bottles', tone: 'blue' },
  { value: 'RICE', label: 'Rice', tone: 'amber' },
] as const;
export type BusinessLine = (typeof BUSINESS_LINES)[number]['value'];
export const lineLabel = (l: string | null | undefined) => BUSINESS_LINES.find((x) => x.value === l)?.label ?? 'Shared';
export const lineTone = (l: string | null | undefined): Tone => BUSINESS_LINES.find((x) => x.value === l)?.tone ?? '';

export const SALE_TYPES = [
  { value: 'COUNTER', label: 'Counter sale', short: 'Counter' },
  { value: 'DELIVERY', label: 'Delivery (vehicle)', short: 'Delivery' },
] as const;
export const saleTypeLabel = (t: string) => SALE_TYPES.find((x) => x.value === t)?.short ?? t;

export const CUSTOMER_TYPES = [
  { value: 'CASH', label: 'Cash', long: 'Cash customer', tone: 'green' },
  { value: 'CREDIT', label: 'Udhaar', long: 'Udhaar customer', tone: 'amber' },
] as const;
export const customerTypeLabel = (t: string) => CUSTOMER_TYPES.find((x) => x.value === t)?.label ?? t;
export const customerTypeTone = (t: string): Tone => CUSTOMER_TYPES.find((x) => x.value === t)?.tone ?? '';

export const LOCATION_TYPES = [
  { value: 'GODOWN', label: 'Godown', tone: 'blue' },
  { value: 'SHOP', label: 'Shop', tone: 'green' },
  { value: 'VEHICLE', label: 'Vehicle', tone: 'amber' },
] as const;

export const SUPPLIER_TYPES = [
  { value: 'BEVERAGE', label: 'Beverage distributor' },
  { value: 'RICE_MILL', label: 'Rice mill' },
  { value: 'OTHER', label: 'Other' },
] as const;

export const RETURN_REASONS = [
  { value: 'DAMAGED', label: 'Damaged', tone: 'red' },
  { value: 'EXPIRED', label: 'Expired', tone: 'amber' },
] as const;

export const ATTENDANCE_STATUSES = [
  { value: 'PRESENT', label: 'Present', tone: 'green' },
  { value: 'ABSENT', label: 'Absent', tone: 'red' },
  { value: 'HALF_DAY', label: 'Half day', tone: 'amber' },
  { value: 'PAID_LEAVE', label: 'Paid leave', tone: 'blue' },
  { value: 'UNPAID_LEAVE', label: 'Unpaid leave', tone: '' },
] as const;

/** Customer khata entry types. */
export const CUSTOMER_LEDGER_LABEL: Record<string, string> = { SALE: 'Bill', PAYMENT: 'Payment', SALE_CANCEL: 'Bill cancelled', PAYMENT_CANCEL: 'Payment cancelled' };
/** Supplier ledger entry types. */
export const SUPPLIER_LEDGER_LABEL: Record<string, string> = { PURCHASE: 'Purchase', PAYMENT: 'Payment', RETURN: 'Return', CANCEL: 'Cancelled purchase' };

/** Units as people say them: a carton of bottles is a "peti", a 50 kg rice bag a "bori". */
const UNIT_WORD: Record<string, string> = { BOTTLE: 'bottle', CARTON: 'peti', KG: 'kg', MAUND: 'maund', BAG: 'bag' };
export const unitLabel = (u: string) => UNIT_WORD[u] ?? u.toLowerCase();
/** Longer form for pickers: "Peti (carton)". */
export const unitTitle = (u: string) => ({ CARTON: 'Peti (carton)', MAUND: 'Maund (40 kg)', BAG: 'Bag / bori' } as Record<string, string>)[u] ?? unitLabel(u).replace(/^./, (c) => c.toUpperCase());
export const productLabel = (p: { name: string; size: string | null }) => (p.size ? `${p.name} (${p.size})` : p.name);

/** Badge for a document's state. */
export function docStatus(status: string): { label: string; tone: Tone } {
  return status === 'CANCELLED' ? { label: 'Cancelled', tone: 'red' } : { label: 'Active', tone: 'green' };
}

/** Badge for what is still owed on a bill or purchase. */
export function dueStatus(status: string, total: number, paid: number, word: 'Udhaar' | 'Due' = 'Udhaar'): { label: string; tone: Tone } {
  if (status === 'CANCELLED') return { label: 'Cancelled', tone: 'red' };
  const due = total - paid;
  return due > 0 ? { label: `${word} ${Math.round(due).toLocaleString('en-PK')}`, tone: 'amber' } : { label: 'Paid', tone: 'green' };
}
