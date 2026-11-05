import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

export type PayStatus = 'PAID' | 'PART' | 'UNPAID';

export interface AllocSale { id: string; billNo: string; date: Date; createdAt: Date; net: Dec }
export interface AllocPayment { id: string; receiptNo: string; date: Date; createdAt: Date; amount: Dec; method: string; saleId: string | null }

export interface BillAllocation {
  saleId: string; billNo: string; date: Date; net: Dec; paid: Dec; remaining: Dec; status: PayStatus;
  /** Whole days since the bill date while something is still owed. */
  ageDays: number;
  payments: { paymentId: string; receiptNo: string; date: Date; method: string; amount: Dec }[];
}

export interface PaymentAllocation {
  paymentId: string; applied: { saleId: string | null; billNo: string; amount: Dec }[]; unallocated: Dec;
}

export interface CustomerAllocation {
  bills: BillAllocation[];
  payments: PaymentAllocation[];
  /** What is left of the opening balance (old khata brought forward). */
  openingRemaining: Dec;
  /** Money received that no bill has used yet (a customer paying in advance, or a credit opening balance). */
  advance: Dec;
}

interface Slot { key: string; saleId: string | null; label: string; left: Dec; bill?: BillAllocation }
interface Credit { payment: AllocPayment; left: Dec; out: PaymentAllocation }

/**
 * Splits a customer's payments across their bills, oldest bill first, so "which bill is still owed" has an answer.
 * Pure: the khata balance stays the one running total, this only explains it.
 *  - a receipt taken with a bill goes to that bill first;
 *  - any other receipt goes to the oldest bill still owing (the old khata balance counts as the oldest);
 *  - a receipt with nothing to pay yet waits and is used by the next bill.
 * Pass active bills and active receipts only: a cancelled bill or a bounced cheque simply isn't there.
 */
export function allocate(
  input: { openingBalance: Dec; sales: AllocSale[]; payments: AllocPayment[] },
  today = new Date(),
): CustomerAllocation {
  const byTime = <T extends { date: Date; createdAt: Date }>(a: T, b: T) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime();
  const sales = [...input.sales].sort(byTime);
  const payments = [...input.payments].sort(byTime);

  const slots: Slot[] = [];
  const credits: Credit[] = [];
  const outs = new Map<string, PaymentAllocation>();
  const billOf = new Map<string, BillAllocation>();
  const paymentsOf = new Map<string, AllocPayment[]>();
  for (const p of payments) {
    if (p.saleId) paymentsOf.set(p.saleId, [...(paymentsOf.get(p.saleId) ?? []), p]);
    outs.set(p.id, { paymentId: p.id, applied: [], unallocated: ZERO });
  }

  const opening: Slot | null = input.openingBalance.gt(0) ? { key: 'opening', saleId: null, label: 'Opening balance', left: input.openingBalance } : null;
  if (opening) slots.push(opening);
  let advance = input.openingBalance.lt(0) ? input.openingBalance.neg() : ZERO;
  const today0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const apply = (slot: Slot, credit: Credit, amount: Dec) => {
    slot.left = slot.left.minus(amount);
    credit.left = credit.left.minus(amount);
    credit.out.applied.push({ saleId: slot.saleId, billNo: slot.label, amount });
    if (slot.bill) {
      slot.bill.paid = slot.bill.paid.plus(amount);
      slot.bill.payments.push({ paymentId: credit.payment.id, receiptNo: credit.payment.receiptNo, date: credit.payment.date, method: credit.payment.method, amount });
    }
  };
  const drain = (credit: Credit) => {
    for (const slot of slots) {
      if (credit.left.lte(0)) break;
      if (slot.left.lte(0)) continue;
      apply(slot, credit, Prisma.Decimal.min(slot.left, credit.left));
    }
  };

  type Event = { at: Date; created: Date; sale?: AllocSale; payment?: AllocPayment };
  const events: Event[] = [
    ...sales.map((s) => ({ at: s.date, created: s.createdAt, sale: s })),
    ...payments.filter((p) => !p.saleId || !sales.some((s) => s.id === p.saleId)).map((p) => ({ at: p.date, created: p.createdAt, payment: p })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.created.getTime() - b.created.getTime());

  for (const ev of events) {
    if (ev.sale) {
      const s = ev.sale;
      const bill: BillAllocation = { saleId: s.id, billNo: s.billNo, date: s.date, net: s.net, paid: ZERO, remaining: s.net, status: 'UNPAID', ageDays: 0, payments: [] };
      billOf.set(s.id, bill);
      const slot: Slot = { key: s.id, saleId: s.id, label: s.billNo, left: s.net, bill };
      slots.push(slot);
      // Receipt taken with this bill pays it first.
      for (const p of paymentsOf.get(s.id) ?? []) {
        const credit: Credit = { payment: p, left: p.amount, out: outs.get(p.id)! };
        if (slot.left.gt(0)) apply(slot, credit, Prisma.Decimal.min(slot.left, credit.left));
        credits.push(credit);
        drain(credit); // never more than the bill, but keeps any surplus from vanishing
      }
      // Then money that was waiting (advance receipts), oldest first.
      for (const c of credits) {
        if (slot.left.lte(0)) break;
        if (c.left.gt(0)) apply(slot, c, Prisma.Decimal.min(slot.left, c.left));
      }
    } else if (ev.payment) {
      const credit: Credit = { payment: ev.payment, left: ev.payment.amount, out: outs.get(ev.payment.id)! };
      credits.push(credit);
      drain(credit);
    }
  }

  // An advance from the opening balance can still be used by the oldest bill that is owed.
  if (advance.gt(0)) {
    for (const slot of slots) {
      if (advance.lte(0)) break;
      if (slot.left.lte(0) || slot === opening) continue;
      const take = Prisma.Decimal.min(slot.left, advance);
      slot.left = slot.left.minus(take);
      advance = advance.minus(take);
      if (slot.bill) slot.bill.paid = slot.bill.paid.plus(take);
    }
  }

  let leftover = advance;
  for (const c of credits) { c.out.unallocated = c.left; leftover = leftover.plus(c.left); }

  const bills = [...billOf.values()];
  for (const b of bills) {
    const slot = slots.find((x) => x.key === b.saleId)!;
    b.remaining = slot.left;
    b.status = slot.left.lte(0) ? 'PAID' : b.paid.gt(0) ? 'PART' : 'UNPAID';
    b.ageDays = b.remaining.gt(0) ? Math.max(0, Math.floor((today0 - Date.UTC(b.date.getUTCFullYear(), b.date.getUTCMonth(), b.date.getUTCDate())) / 86400000)) : 0;
  }
  return {
    bills,
    payments: payments.map((p) => outs.get(p.id)!),
    openingRemaining: opening ? opening.left : ZERO,
    advance: leftover,
  };
}

type Db = Pick<Prisma.TransactionClient, 'customer' | 'sale' | 'payment'>;

/** Allocation for several customers with three queries, so a bill list can show paid / part / unpaid. */
export async function loadAllocations(db: Db, customerIds: string[]): Promise<Map<string, CustomerAllocation>> {
  const ids = [...new Set(customerIds)];
  const result = new Map<string, CustomerAllocation>();
  if (!ids.length) return result;
  const [customers, sales, payments] = await Promise.all([
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, openingBalance: true } }),
    db.sale.findMany({ where: { customerId: { in: ids }, status: 'ACTIVE' }, select: { id: true, customerId: true, billNo: true, date: true, createdAt: true, net: true } }),
    db.payment.findMany({ where: { customerId: { in: ids }, status: 'ACTIVE' }, select: { id: true, customerId: true, receiptNo: true, date: true, createdAt: true, amount: true, method: true, saleId: true } }),
  ]);
  for (const c of customers) {
    result.set(c.id, allocate({
      openingBalance: c.openingBalance,
      sales: sales.filter((s) => s.customerId === c.id),
      payments: payments.filter((p) => p.customerId === c.id),
    }));
  }
  return result;
}
