import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());
const num = (v) => Number(v);

describe('reorder plan', () => {
  it('works out days left and what to buy from the real selling speed, and spots stock that stopped selling', async () => {
    const fast = await stockedWorld(t.owner, 20);   // 120 bottles
    const idle = await stockedWorld(t.owner, 5);    // 30 bottles, never sold
    ok(await t.owner.post('/sales', { saleType: 'COUNTER', locationId: fast.godown.id, paidNow: 12000, items: [{ productId: fast.product.id, unitName: 'CARTON', qty: 16 }] }));

    const plan = ok(await t.owner.get('/stock/reorder?days=7&cover=14'));
    const a = plan.rows.find((r) => r.productId === fast.product.id);
    expect(num(a.onHand)).toBe(24);                      // 120 - 96 bottles
    expect(num(a.soldInWindow)).toBe(96);
    expect(num(a.perDay)).toBeCloseTo(96 / 7, 3);
    expect(num(a.daysLeft)).toBeCloseTo(24 / (96 / 7), 2);
    expect(a.status).toBe('URGENT');
    expect(a.buy.unitName).toBe('CARTON');               // the unit it was last bought in
    expect(num(a.buy.units)).toBe(28);                   // 14 days x 13.7 a day = 192 bottles, minus 24 in stock = 168 = 28 cartons
    expect(a.lastBought.supplier.name).toBeTruthy();

    const b = plan.rows.find((r) => r.productId === idle.product.id);
    expect(b.status).toBe('DEAD');
    expect(b.buy).toBeNull();
    expect(num(plan.totals.dead)).toBeGreaterThanOrEqual(1);
    expect(plan.rows.findIndex((r) => r.productId === fast.product.id)).toBeLessThan(plan.rows.findIndex((r) => r.productId === idle.product.id)); // urgent before dead

    // out-of-range inputs are held inside sensible limits instead of failing
    expect(ok(await t.owner.get('/stock/reorder?days=9999&cover=0')).days).toBe(180);
  });
});
