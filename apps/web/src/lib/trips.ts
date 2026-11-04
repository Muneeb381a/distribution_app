/** Vehicle trips as the API returns them. */

export interface TripLine {
  productId: string; name: string; size: string | null; baseUnit: string; units: { unitName: string; factorToBase: string }[];
  atStart: string; loaded: string; sold: string; other: string; expected: string; damaged: string;
}
export interface SettledLine { productId: string; loaded: string; sold: string; expected: string; counted: string; diff: string; unloaded: string; product: { name: string; size: string | null } }
export interface Trip {
  id: string; tripNo: string; status: 'OPEN' | 'SETTLED'; date: string; openedAt: string; settledAt: string | null; note: string | null;
  vehicle: { id: string; name: string }; salesman: { id: string; name: string } | null;
  cashExpected: string | null; cashReceived: string | null;
}
export interface TripDetail extends Trip {
  lines: TripLine[]; settledLines: SettledLine[];
  sales: { id: string; billNo: string; net: string; paidNow: string; createdAt: string; customer: { id: string; name: string } | null }[];
  totals: { bills: number; net: string; paid: string; udhaar: string };
  cash: { expected: string; byMethod: Record<string, string>; received: string | null; short: string | null };
  advance: { id: string; amount: string } | null;
}
export interface TripRow extends Trip { lines: { diff: string }[] }
