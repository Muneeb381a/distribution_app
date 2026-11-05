import { Prisma } from '@prisma/client';

type Dec = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

/**
 * The one definition of a balance: opening balance plus every ledger entry.
 * Customers: positive = they owe us. Suppliers: positive = we owe them.
 * Used by the khata, the dashboard, sync and the supplier screens so they can never disagree.
 */
export async function withCustomerBalances<T extends { id: string; openingBalance: Dec }>(
  db: Pick<Prisma.TransactionClient, 'customerLedger'>, customers: T[],
): Promise<(T & { balance: Dec })[]> {
  if (!customers.length) return [];
  const sums = await db.customerLedger.groupBy({ by: ['customerId'], where: { customerId: { in: customers.map((c) => c.id) } }, _sum: { amount: true } });
  const moved = new Map(sums.map((s) => [s.customerId, s._sum.amount ?? ZERO]));
  return customers.map((c) => ({ ...c, balance: c.openingBalance.plus(moved.get(c.id) ?? ZERO) }));
}

export async function customerBalance(db: Pick<Prisma.TransactionClient, 'customerLedger'>, customer: { id: string; openingBalance: Dec }): Promise<Dec> {
  const sum = await db.customerLedger.aggregate({ where: { customerId: customer.id }, _sum: { amount: true } });
  return customer.openingBalance.plus(sum._sum.amount ?? ZERO);
}

export async function withSupplierBalances<T extends { id: string; openingBalance: Dec }>(
  db: Pick<Prisma.TransactionClient, 'supplierLedger'>, suppliers: T[],
): Promise<(T & { balance: Dec })[]> {
  if (!suppliers.length) return [];
  const sums = await db.supplierLedger.groupBy({ by: ['supplierId'], where: { supplierId: { in: suppliers.map((s) => s.id) } }, _sum: { amount: true } });
  const moved = new Map(sums.map((s) => [s.supplierId, s._sum.amount ?? ZERO]));
  return suppliers.map((s) => ({ ...s, balance: s.openingBalance.plus(moved.get(s.id) ?? ZERO) }));
}

/** Over the credit limit right now (a limit of 0 counts). */
export const overLimit = (balance: Dec, creditLimit: Dec | null) => !!creditLimit && balance.gt(creditLimit);
