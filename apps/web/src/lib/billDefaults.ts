/**
 * Where each user usually bills from, remembered on this PC: the location per sale type and the
 * salesman for deliveries. New bills start from these; saving a bill updates them.
 */
type SaleType = 'COUNTER' | 'DELIVERY';
type Defaults = Partial<Record<SaleType, { locationId?: string; salesmanId?: string; vehicleId?: string }>>;

const key = (userId: string) => `dist.billDefaults.${userId}`;

export function readBillDefaults(userId: string | undefined): Defaults {
  if (!userId) return {};
  try {
    return JSON.parse(localStorage.getItem(key(userId)) ?? '{}') as Defaults;
  } catch {
    return {};
  }
}

export function rememberBillDefaults(userId: string | undefined, saleType: string, locationId: string, salesmanId: string, vehicleId = '') {
  if (!userId || (saleType !== 'COUNTER' && saleType !== 'DELIVERY')) return;
  try {
    const d = readBillDefaults(userId);
    d[saleType] = { locationId: locationId || undefined, salesmanId: salesmanId || undefined, vehicleId: vehicleId || undefined };
    localStorage.setItem(key(userId), JSON.stringify(d));
  } catch { /* storage blocked: nothing remembered */ }
}
