import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t, w, prefix;
beforeAll(async () => {
  t = await boot();
  w = await stockedWorld(t.owner, 20);
  prefix = ok(await t.owner.post('/sync/device')).prefix;
});
afterAll(() => t.close());

let seq = 0;
const no = (kind) => `${kind}-${prefix}-${String(++seq).padStart(6, '0')}`;
const customer = async (extra = {}) => ok(await t.owner.post('/customers', { name: uniq('Shop'), type: 'CREDIT', creditLimit: 5000, ...extra }));
const saleOp = (customerId, cartons, extra = {}) => ({
  kind: 'SALE', clientId: crypto.randomUUID(), number: no('BTL'), savedAt: new Date().toISOString(),
  sale: { saleType: 'COUNTER', customerId, locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: cartons }], ...extra },
});
const push = async (ops) => ok(await t.owner.post('/sync/push', { ops })).results;
const balanceOf = async (id) => Number(ok(await t.owner.get('/khata/balances')).find((r) => r.id === id).balance);

describe('offline sync', () => {
  it('gives each device its own number prefix', async () => {
    const other = ok(await t.owner.post('/sync/device')).prefix;
    expect(prefix).toMatch(/^D\d+$/);
    expect(other).not.toBe(prefix);
  });

  it('the snapshot carries what the bill screen needs, with balances', async () => {
    const c = await customer({ openingBalance: 1200 });
    const s = ok(await t.owner.get('/sync/snapshot'));
    expect(s.products.some((p) => p.id === w.product.id)).toBe(true);
    expect(s.prices.some((p) => p.productId === w.product.id)).toBe(true);
    expect(Number(s.customers.find((x) => x.id === c.id).balance)).toBe(1200);
    expect(Number(s.stock.find((x) => x.productId === w.product.id && x.locationId === w.godown.id).qtyBase)).toBeGreaterThan(0);
  });

  it('keeps the device bill number, and a replay does not create a second bill', async () => {
    const c = await customer();
    const before = await w.stockOf(w.godown.id);
    const op = saleOp(c.id, 1, { paidNow: 250 });
    const [a] = await push([op]);
    expect(a.status).toBe('created');
    expect(a.number).toBe(op.number);
    const [b] = await push([op]);
    expect(b.status).toBe('duplicate');
    expect(b.id).toBe(a.id);
    expect(before - (await w.stockOf(w.godown.id))).toBe(6);
    expect(await balanceOf(c.id)).toBe(500);
    expect(ok(await t.owner.get(`/sales/${a.id}`)).billNo).toBe(op.number);
  });

  it('accepts a bill that crossed the limit on stale data, and flags it', async () => {
    const c = await customer({ creditLimit: 500 });
    const [r] = await push([saleOp(c.id, 2)]);
    expect(r.status).toBe('created');
    expect(r.flags[0]).toMatch(/CREDIT_LIMIT_EXCEEDED/);
    const audit = ok(await t.owner.get(`/audit-log?entity=Sale&entityId=${r.id}&action=OFFLINE_CREDIT_BREACH`));
    expect(audit.length).toBe(1);
  });

  it('online bills still refuse to cross the limit', async () => {
    const c = await customer({ creditLimit: 500 });
    const res = await t.owner.post('/sales', saleOp(c.id, 2).sale);
    expect(res.status).toBe(400);
  });

  it('a bill there is no stock for is left for a person, and nothing is half-saved', async () => {
    const c = await customer({ creditLimit: 1_000_000 });
    const before = await w.stockOf(w.godown.id);
    const [r] = await push([saleOp(c.id, 10_000)]);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Not enough stock/);
    expect(await w.stockOf(w.godown.id)).toBe(before);
    expect(await balanceOf(c.id)).toBe(0);
  });

  it('one failed operation does not stop the others', async () => {
    const c = await customer({ creditLimit: 1_000_000 });
    const res = await push([saleOp(c.id, 10_000), saleOp(c.id, 1)]);
    expect(res.map((r) => r.status)).toEqual(['failed', 'created']);
  });

  it('records an offline receipt under its device number, once', async () => {
    const c = await customer({ openingBalance: 900 });
    const op = { kind: 'PAYMENT', clientId: crypto.randomUUID(), number: no('RCP'), payment: { customerId: c.id, amount: 400, method: 'CASH' } };
    const [a] = await push([op]);
    const [b] = await push([op]);
    expect(a.status).toBe('created');
    expect(b.status).toBe('duplicate');
    expect(ok(await t.owner.get(`/payments/${a.id}`)).receiptNo).toBe(op.number);
    expect(await balanceOf(c.id)).toBe(500);
  });

  it('rejects numbers that are not device numbers, and a bottle number on a rice bill', async () => {
    const c = await customer();
    const bad = { ...saleOp(c.id, 1), number: 'BTL-000123' };
    const res = await t.owner.post('/sync/push', { ops: [bad] });
    expect(res.status).toBe(400);
    const rice = { ...saleOp(c.id, 1), number: no('RIC') };
    const [r] = await push([rice]);
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/does not match/);
  });

  it('a number used twice by different bills is refused for the second', async () => {
    const c = await customer({ creditLimit: 1_000_000 });
    const first = saleOp(c.id, 1);
    const second = { ...saleOp(c.id, 1), number: first.number };
    const res = await push([first, second]);
    expect(res.map((r) => r.status)).toEqual(['created', 'failed']);
  });

  it('needs the selling permission', async () => {
    const res = await t.as().post('/sync/push', { ops: [] });
    expect(res.status).toBe(401);
  });
});
