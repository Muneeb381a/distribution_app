import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const preview = (body) => t.owner.post('/sales/preview', body);

describe('price tiers', () => {
  it('wholesale customers pay the wholesale list rate, falling back to retail; fixed rates still win', async () => {
    const w = await stockedWorld(t.owner, 10); // retail: bottle 125, carton 750
    ok(await t.owner.put(`/product-prices/${w.product.id}`, { prices: [
      { unitName: 'BOTTLE', rate: 125 }, { unitName: 'CARTON', rate: 750 },
      { unitName: 'CARTON', tier: 'WHOLESALE', rate: 700 },
    ] }));
    expect((await t.owner.put(`/product-prices/${w.product.id}`, { prices: [{ unitName: 'CARTON', rate: 1 }, { unitName: 'CARTON', tier: 'RETAIL', rate: 2 }] })).status).toBe(400); // two retail rates
    const retail = ok(await t.owner.post('/customers', { name: uniq('Retailer'), type: 'CREDIT', creditLimit: 100000 }));
    const dealer = ok(await t.owner.post('/customers', { name: uniq('Dealer'), type: 'CREDIT', creditLimit: 100000, priceTier: 'WHOLESALE' }));
    expect(dealer.priceTier).toBe('WHOLESALE');
    expect((await t.owner.post('/customers', { name: uniq('X'), priceTier: 'VIP' })).status).toBe(400);

    const line = (unitName) => ({ saleType: 'COUNTER', locationId: w.godown.id, paidNow: 0, items: [{ productId: w.product.id, unitName, qty: 1 }] });
    const rateOf = async (body) => Number(ok(await preview(body)).items[0].rate);
    expect(await rateOf({ ...line('CARTON'), customerId: retail.id })).toBe(750);
    expect(await rateOf({ ...line('CARTON'), customerId: dealer.id })).toBe(700);
    expect(await rateOf({ ...line('BOTTLE'), customerId: dealer.id })).toBe(125); // no wholesale bottle rate: retail
    expect(await rateOf({ ...line('CARTON'), paidNow: 750 })).toBe(750); // walk-in: retail

    ok(await t.owner.put(`/customers/${dealer.id}/rates`, { rates: [{ productId: w.product.id, unitName: 'CARTON', rate: 690 }] }));
    expect(await rateOf({ ...line('CARTON'), customerId: dealer.id })).toBe(690); // fixed rate wins

    // the bulk change can target one list
    ok(await t.owner.post('/product-prices/change', { productIds: [w.product.id], amount: 60, unitName: 'CARTON', tier: 'WHOLESALE' }));
    const prices = ok(await t.owner.get(`/product-prices?productId=${w.product.id}`));
    const p = (unit, tier) => Number(prices.find((x) => x.unitName === unit && x.tier === tier).rate);
    expect(p('CARTON', 'WHOLESALE')).toBe(760);
    expect(p('CARTON', 'RETAIL')).toBe(750);

    const snap = ok(await t.owner.get('/sync/snapshot'));
    expect(snap.customers.find((c) => c.id === dealer.id).priceTier).toBe('WHOLESALE');
    expect(snap.prices.some((x) => x.productId === w.product.id && x.tier === 'WHOLESALE')).toBe(true);
  });
});
