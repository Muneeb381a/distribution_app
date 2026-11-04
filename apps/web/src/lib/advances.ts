/** Salary advances as the API returns them, and how to describe where one stands. */

export interface Advance {
  id: string; employeeId: string; date: string; amount: string; installment: string | null; note: string | null; status: string;
  recovered: string; remaining: string; employee: { name: string };
}

/** Where an advance stands: cancelled, fully recovered, partly recovered, or waiting for the first cut. */
export function advanceState(a: Pick<Advance, 'status' | 'recovered' | 'remaining'>) {
  if (a.status === 'CANCELLED') return { label: 'Cancelled', tone: '' };
  if (Number(a.remaining) <= 0) return { label: 'Recovered', tone: 'green' };
  if (Number(a.recovered) > 0) return { label: 'Being recovered', tone: 'blue' };
  return { label: 'Not cut yet', tone: 'amber' };
}
