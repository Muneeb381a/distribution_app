/**
 * The selling rules, written once. The server (sales.service) and the offline bill screen
 * (lib/offline) both call these, so a bill can never be priced or checked differently offline.
 * Money arithmetic stays with the caller (Decimal on the server); these functions decide and word.
 */

/** A rule a bill broke. `status` is the HTTP status the server answers with. */
export class RuleError extends Error {
  constructor(message: string, public status: 400 | 403 = 400) {
    super(message);
    this.name = 'RuleError';
  }
}

export interface SaleHead { saleType: string; customerId?: string | null; salesmanId?: string | null }

/** Who and where: a delivery needs a salesman and a customer. */
export function checkSaleHead(h: SaleHead) {
  if (h.saleType === 'DELIVERY' && !h.salesmanId) throw new RuleError('A delivery needs a salesman');
  if (h.saleType === 'DELIVERY' && !h.customerId) throw new RuleError('A delivery needs a customer');
}

/**
 * Which location types a sale may come from. A delivery can go straight from the godown or shop (the vehicle
 * is then only the carrier, no separate loading) or from a vehicle that was loaded for a round.
 */
export const saleLocationTypes = (saleType: string): ('SHOP' | 'GODOWN' | 'VEHICLE')[] => (saleType === 'DELIVERY' ? ['SHOP', 'GODOWN', 'VEHICLE'] : ['SHOP', 'GODOWN']);

export function checkHasLines(items: number, returns: number) {
  if (!items && !returns) throw new RuleError('Add at least one item or return');
}

/**
 * The rate for one line: the customer's fixed rate, else the product's list price. An entered rate
 * different from that needs RATE_EDIT; a missing rate must be entered by someone who has it.
 * Returns the rate as given (string or number) so the caller keeps its own precision.
 */
export function chooseRate<T extends string | number>(o: {
  productName: string; unitName: string; fixed?: T | null; list?: T | null; entered?: number | null; canEditRate: boolean;
}): T | number {
  const standard = o.fixed ?? o.list ?? null;
  if (o.entered === null || o.entered === undefined) {
    if (standard === null || standard === undefined) {
      if (!o.canEditRate) throw new RuleError(`No rate is set for ${o.productName} (${o.unitName}); ask someone who can set rates`, 403);
      throw new RuleError(`No rate is set for ${o.productName} (${o.unitName}); enter one`);
    }
    return standard;
  }
  if ((standard === null || standard === undefined || Number(standard) !== o.entered) && !o.canEditRate) {
    throw new RuleError(`You are not allowed to change the rate of ${o.productName}`, 403);
  }
  return o.entered;
}

/** One business line per bill: bottles and rice are billed and numbered separately. */
export function checkOneLine<L extends string>(lines: Iterable<L>): L {
  const set = new Set(lines);
  if (set.size > 1) throw new RuleError('A bill can hold bottles or rice, not both. Make two bills.');
  const [line] = set;
  return line;
}

/** Paid now when the user didn't say: walk-in and cash customers pay the bill, udhaar customers pay nothing. */
export function defaultPaid(customer: { type: string } | null | undefined, net: number): number {
  const cashLike = !customer || customer.type === 'CASH';
  return cashLike ? Math.max(net, 0) : 0;
}

export function checkPayment(o: { hasCustomer: boolean; net: number; paid: number }) {
  if (o.net < 0 && o.paid > 0) throw new RuleError('A bill that credits the customer cannot also take payment');
  if (!o.hasCustomer && o.paid !== o.net) throw new RuleError('A sale without a customer must be paid in full');
}

/**
 * Why a bill can't go on khata, or null. Cash customers must pay in full; udhaar customers may not
 * cross their credit limit. Saving anyway needs CREDIT_OVERRIDE (or comes from an offline PC).
 */
export function creditBlock(o: { customer: { type: string; creditLimit: string | number | null } | null; net: number; paid: number; newBalance: number }): string | null {
  const c = o.customer;
  if (!c || o.net - o.paid <= 0) return null;
  if (c.type === 'CASH') return 'CASH_CUSTOMER_UNPAID: a cash customer must pay in full';
  if (c.creditLimit !== null && c.creditLimit !== undefined && c.creditLimit !== '' && o.newBalance > Number(c.creditLimit)) {
    return `CREDIT_LIMIT_EXCEEDED: balance would be ${o.newBalance} against a limit of ${Number(c.creditLimit)}`;
  }
  return null;
}

/** Empties handed over with a bill: one per bottle of a returnable product, per line. */
export const emptiesGiven = (qtyBase: number) => Math.round(qtyBase);

export const shortageText = (productName: string, have: number | string, need: number | string) => `${productName}: have ${have}, need ${need}`;

/** Price lists. Every customer is on one; walk-in sales use retail. */
export const PRICE_TIERS = [
  { value: 'RETAIL', label: 'Retail', description: 'The standard list rate' },
  { value: 'WHOLESALE', label: 'Wholesale', description: 'Lower rate for bulk buyers and dealers' },
] as const;
export type PriceTier = (typeof PRICE_TIERS)[number]['value'];
export const tierLabel = (t: string | null | undefined) => PRICE_TIERS.find((x) => x.value === t)?.label ?? 'Retail';

/**
 * The list rate for a product and unit on a price list. A product without a wholesale rate sells to
 * wholesale customers at retail, so a missing wholesale rate never blocks a bill. Rows without a
 * tier (older data) are retail.
 */
export function listRate<T>(prices: { productId: string; unitName: string; tier?: string | null; rate: T }[], productId: string, unitName: string, tier?: string | null): T | null {
  const at = (t: string) => prices.find((p) => p.productId === productId && p.unitName === unitName && (p.tier ?? 'RETAIL') === t)?.rate;
  return (tier === 'WHOLESALE' ? at('WHOLESALE') : undefined) ?? at('RETAIL') ?? null;
}
