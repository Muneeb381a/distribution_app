import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('stock history', () => {
  it('is a stock card per product: opening, each movement with its document and the stock after it', async () => {
    const w = await stockedWorld(t.owner, 10); // 10 cartons = 60 bottles into the godown
    const c = ok(await t.owner.post('/customers', { name: uniq('Card shop'), type: 'CREDIT', creditLimit: 100000 }));
    const bill = ok(await t.owner.post('/sales', { saleType: 'COUNTER', customerId: c.id, locationId: w.godown.id, paidNow: 0, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] }));
    ok(await t.owner.post('/stock/transfers', { fromLocationId: w.godown.id, toLocationId: w.shop.id, items: [{ productId: w.product.id, unitName: 'BOTTLE', qty: 12 }] }));
    ok(await t.owner.post('/stock/adjustments', { productId: w.product.id, locationId: w.godown.id, unitName: 'BOTTLE', qty: 2, kind: 'MARK_DAMAGED', note: 'broken' }));

    const h = ok(await t.owner.get(`/stock/history?productId=${w.product.id}&locationId=${w.godown.id}&from=${today()}&to=${today()}`));
    expect(Number(h.opening.ok)).toBe(0);
    expect(h.rows.map((r) => r.type)).toEqual(['PURCHASE', 'SALE', 'TRANSFER_OUT', 'DAMAGE_MARK', 'DAMAGE_MARK']);
    expect(h.rows.map((r) => Number(r.okAfter))).toEqual([60, 54, 42, 40, 40]);
    expect(Number(h.closing.damaged)).toBe(2);
    expect(h.rows[1].doc).toMatchObject({ no: bill.billNo, party: c.name });
    expect(h.rows[2].doc.party).toBe(`${w.godown.name} → ${w.shop.name}`);
    expect(h.rows[0].by).toBe('owner');

    // all locations together: the transfer moves stock, it does not change the total
    const all = ok(await t.owner.get(`/stock/history?productId=${w.product.id}&from=${today()}&to=${today()}`));
    expect(Number(all.closing.ok)).toBe(54 - 2);

    const sales = ok(await t.owner.get(`/stock/history?type=SALE&from=${today()}&to=${today()}`));
    expect(sales.rows.every((r) => r.type === 'SALE')).toBe(true);
    expect(sales.opening).toBeUndefined();
    expect((await t.owner.get('/stock/history?from=2026-11-05&to=2026-11-01')).status).toBe(400);
  });
});
