import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t, w;
beforeAll(async () => {
  t = await boot();
  w = await stockedWorld(t.owner);
});
afterAll(() => t.close());

const customer = async (extra = {}) => ok(await t.owner.post('/customers', { name: uniq('Shop'), type: 'CREDIT', creditLimit: 5000, ...extra }));
const bill = (customerId, items, extra = {}) => ({ saleType: 'COUNTER', customerId, locationId: w.godown.id, items, ...extra });
const cartons = (qty) => ({ productId: w.product.id, unitName: 'CARTON', qty });
const balanceOf = async (id) => Number(ok(await t.owner.get('/khata/balances')).find((r) => r.id === id).balance);

describe('selling on khata', () => {
  it('a part-paid bill adds the unpaid part to the khata and takes stock out', async () => {
    const c = await customer();
    const before = await w.stockOf(w.godown.id);
    const res = await t.owner.post('/sales', bill(c.id, [cartons(2)], { paidNow: 1000 }));
    expect(res.status).toBe(201);
    expect(Number(res.body.net)).toBe(1500);
    expect(Number(res.body.newBalance)).toBe(500);
    expect(await balanceOf(c.id)).toBe(500);
    expect(before - (await w.stockOf(w.godown.id))).toBe(12); // 2 cartons = 12 bottles
  });

  it('the same clientId creates one bill, not two', async () => {
    const c = await customer();
    const body = bill(c.id, [cartons(1)], { paidNow: 750, clientId: crypto.randomUUID() });
    const before = await w.stockOf(w.godown.id);
    const a = await t.owner.post('/sales', body);
    const b = await t.owner.post('/sales', body);
    expect(a.body.id).toBe(b.body.id);
    expect(before - (await w.stockOf(w.godown.id))).toBe(6);
  });

  it('a payment brings the balance down and the receipt shows before and after', async () => {
    const c = await customer({ openingBalance: 800 });
    const res = await t.owner.post('/payments', { customerId: c.id, amount: 300 });
    expect(res.status).toBe(201);
    expect(Number(res.body.previousBalance)).toBe(800);
    expect(Number(res.body.newBalance)).toBe(500);
  });

  it('a walk-in sale must be paid in full', async () => {
    const res = await t.owner.post('/sales', bill(undefined, [cartons(1)], { paidNow: 100 }));
    expect(res.status).toBe(400);
  });

  it('cannot sell more than is in stock', async () => {
    const c = await customer({ creditLimit: 1_000_000 });
    const res = await t.owner.post('/sales', bill(c.id, [cartons(500)], { paidNow: 0 }));
    expect(res.status).toBe(400);
  });
});

describe('credit limit', () => {
  it('blocks a bill that crosses the limit, and only an override lets it through', async () => {
    const c = await customer({ creditLimit: 1000 });
    const blocked = await t.owner.post('/sales', bill(c.id, [cartons(2)], { paidNow: 0 }));
    expect(blocked.status).toBe(400);
    const preview = await t.owner.post('/sales/preview', bill(c.id, [cartons(2)], { paidNow: 0 }));
    expect(preview.body.credit.blocked).toBeTruthy();
    const allowed = await t.owner.post('/sales', bill(c.id, [cartons(2)], { paidNow: 0, overrideCredit: true }));
    expect(allowed.status).toBe(201);
    expect(await balanceOf(c.id)).toBe(1500);
  });

  it('a salesman cannot override the limit or change a rate', async () => {
    const role = ok(await t.owner.get('/roles')).find((r) => r.name === 'Salesman');
    const username = uniq('sm').replace(/\s/g, '');
    ok(await t.owner.post('/users', { username, password: 'secret123', roleId: role.id }));
    const sm = (await t.login(username, 'secret123')).api;
    const c = await customer({ creditLimit: 1000 });
    expect((await sm.post('/sales', bill(c.id, [cartons(2)], { paidNow: 0, overrideCredit: true }))).status).toBe(403);
    expect((await sm.post('/sales', bill(c.id, [{ ...cartons(1), rate: 1 }], { paidNow: 0 }))).status).toBe(403);
    expect((await sm.post('/sales', bill(c.id, [cartons(1)], { paidNow: 0 }))).status).toBe(201);
  });
});

describe('returns and cancellation', () => {
  it('a damaged return credits the customer and moves stock to damaged', async () => {
    const c = await customer();
    const damagedBefore = await w.stockOf(w.godown.id, 'damaged');
    const res = await t.owner.post('/sales', bill(c.id, [cartons(1)], {
      paidNow: 0,
      returns: [{ productId: w.product.id, unitName: 'BOTTLE', qty: 2, reason: 'DAMAGED' }],
    }));
    expect(res.status).toBe(201);
    expect(Number(res.body.returnsCredit)).toBe(250);
    expect(Number(res.body.net)).toBe(500); // 750 - 250
    expect((await w.stockOf(w.godown.id, 'damaged')) - damagedBefore).toBe(2);
  });

  it('cancelling a bill puts stock and the balance back, and cannot be done twice', async () => {
    const c = await customer();
    const before = await w.stockOf(w.godown.id);
    const sale = ok(await t.owner.post('/sales', bill(c.id, [cartons(3)], { paidNow: 500 })));
    expect(await balanceOf(c.id)).toBe(1750);
    expect((await t.owner.post(`/sales/${sale.id}/cancel`)).status).toBe(201);
    expect(await balanceOf(c.id)).toBe(0);
    expect(await w.stockOf(w.godown.id)).toBe(before);
    expect((await t.owner.post(`/sales/${sale.id}/cancel`)).status).toBe(409);
  });

  it('tracks empties per customer', async () => {
    const c = await customer();
    ok(await t.owner.post('/sales', bill(c.id, [cartons(2)], { paidNow: 0, emptiesCollected: [{ productId: w.product.id, qty: 4 }] })));
    const rows = ok(await t.owner.get('/reports/empties'));
    expect(rows.find((r) => r.customerId === c.id).held).toBe(8); // 12 given - 4 collected
  });
});
