import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t, godown, riceCat;
beforeAll(async () => {
  t = await boot();
  godown = ok(await t.owner.get('/locations')).find((l) => l.type === 'GODOWN');
  riceCat = ok(await t.owner.get('/categories?line=RICE'))[0];
});
afterAll(() => t.close());

/** Loose rice: sold by the kg (and parts of a kg), by the maund and by the bag, all from the same stock. */
async function looseRice() {
  const p = ok(await t.owner.post('/products', { categoryId: riceCat.id, name: uniq('Loose rice'), baseUnit: 'KG', units: [{ unitName: 'KG', factorToBase: 1 }, { unitName: 'MAUND', factorToBase: 40 }, { unitName: 'BAG', factorToBase: 50 }] }));
  ok(await t.owner.put(`/product-prices/${p.id}`, { prices: [{ unitName: 'KG', rate: 330 }, { unitName: 'MAUND', rate: 13200 }, { unitName: 'BAG', rate: 16500 }] }));
  const sup = ok(await t.owner.post('/suppliers', { name: uniq('Mill') }));
  ok(await t.owner.post('/purchases', { supplierId: sup.id, locationId: godown.id, items: [{ productId: p.id, unitName: 'BAG', qty: 10, unitPrice: 14000 }] }));
  return p;
}
const held = async (p) => Number(ok(await t.owner.get(`/stock?locationId=${godown.id}&search=${encodeURIComponent(p.name)}`)).find((r) => r.productId === p.id)?.ok ?? 0);
const sell = (p, unitName, qty, extra = {}) => t.owner.post('/sales', { saleType: 'COUNTER', locationId: godown.id, items: [{ productId: p.id, unitName, qty, ...extra }] });

describe('loose rice sold by parts of a kg and by the bag', () => {
  it('sells half a kg, a quarter kg, one kg, a part of a maund and a whole bag from the same stock', async () => {
    const p = await looseRice();
    expect(await held(p)).toBe(500);
    const half = ok(await sell(p, 'KG', 0.5));
    expect(Number(half.net)).toBe(165);
    const quarter = ok(await sell(p, 'KG', 0.25));
    expect(Number(quarter.net)).toBe(82.5);
    expect(Number(ok(await sell(p, 'KG', 1)).net)).toBe(330);
    expect(Number(ok(await sell(p, 'MAUND', 0.25)).net)).toBe(3300); // 10 kg
    expect(Number(ok(await sell(p, 'BAG', 1)).net)).toBe(16500); // 50 kg
    // 0.5 + 0.25 + 1 + 10 + 50 kg gone
    expect(await held(p)).toBe(500 - 61.75);
  });

  it('keeps the quantity as typed on the bill, and in kg in the stock history', async () => {
    const p = await looseRice();
    const bill = ok(await sell(p, 'KG', 0.5));
    const line = ok(await t.owner.get(`/sales/${bill.id}`)).items[0];
    expect(Number(line.qty)).toBe(0.5);
    expect(line.unitName).toBe('KG');
    expect(Number(line.qtyBase)).toBe(0.5);
    const bag = ok(await sell(p, 'BAG', 2));
    const l2 = ok(await t.owner.get(`/sales/${bag.id}`)).items[0];
    expect(Number(l2.qty)).toBe(2);
    expect(Number(l2.qtyBase)).toBe(100);
  });

  it('accepts a quantity with up to three decimals and refuses more, zero and negative', async () => {
    const p = await looseRice();
    expect((await sell(p, 'KG', 0.125)).status).toBe(201);
    expect((await sell(p, 'KG', 0.0005)).status).toBe(400);
    expect((await sell(p, 'KG', 0)).status).toBe(400);
    expect((await sell(p, 'KG', -1)).status).toBe(400);
  });

  it('refuses a sale of more than is there, even by a fraction', async () => {
    const p = await looseRice();
    ok(await sell(p, 'BAG', 9)); // 450 kg gone, 50 left
    expect((await sell(p, 'KG', 50.5)).status).toBe(400);
    expect((await sell(p, 'KG', 50)).status).toBe(201);
    expect(await held(p)).toBe(0);
  });

  it('works out profit on a part of a kg from the cost per kg', async () => {
    const p = await looseRice(); // 14000 a bag = 280 a kg
    const profit = async () => Number(ok(await t.owner.get(`/reports/profit?from=${new Date().toLocaleDateString('en-CA')}&to=${new Date().toLocaleDateString('en-CA')}&groupBy=none`)).rows[0].total.grossProfit);
    const before = await profit();
    ok(await sell(p, 'KG', 0.5)); // 165 sold, 140 cost
    expect(await profit() - before).toBe(25);
  });
});
