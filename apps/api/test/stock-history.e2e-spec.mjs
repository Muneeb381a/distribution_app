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

describe('reorder level', () => {
  it('lists products at or below their level across all locations, and the dashboard counts them', async () => {
    const w = await stockedWorld(t.owner, 5); // 30 bottles
    expect(ok(await t.owner.get('/stock/low')).some((p) => p.productId === w.product.id)).toBe(false); // not watched
    ok(await t.owner.patch(`/products/${w.product.id}`, { reorderLevel: 24 }));
    expect(ok(await t.owner.get('/stock/low')).some((p) => p.productId === w.product.id)).toBe(false); // 30 > 24
    ok(await t.owner.post('/stock/transfers', { fromLocationId: w.godown.id, toLocationId: w.shop.id, items: [{ productId: w.product.id, unitName: 'BOTTLE', qty: 10 }] }));
    expect(ok(await t.owner.get('/stock/low')).some((p) => p.productId === w.product.id)).toBe(false); // still 30 in total
    ok(await t.owner.post('/stock/adjustments', { productId: w.product.id, locationId: w.godown.id, unitName: 'BOTTLE', qty: 6, kind: 'MARK_DAMAGED', note: 'burst' }));
    const low = ok(await t.owner.get('/stock/low')).find((p) => p.productId === w.product.id);
    expect(Number(low.onHand)).toBe(24); // damaged stock does not count
    expect(low.where.map((x) => Number(x.qtyBase)).sort((a, b) => a - b)).toEqual([10, 14]);
    const dash = ok(await t.owner.get('/dashboard/summary'));
    expect(dash.lowStockCount).toBeGreaterThan(0);
    expect(dash.chequesDue).toHaveProperty('count');
    ok(await t.owner.patch(`/products/${w.product.id}`, { reorderLevel: null }));
    expect(ok(await t.owner.get('/stock/low')).some((p) => p.productId === w.product.id)).toBe(false);
  });
});

describe('changing many rates at once', () => {
  it('raises by a percentage or by an amount per peti, previews first, and keeps bottle rates in step', async () => {
    const a = await stockedWorld(t.owner, 5); // bottle 125, carton 750 (6 a carton)
    const b = await stockedWorld(t.owner, 5);
    const ids = [a.product.id, b.product.id];
    const rate = async (pid, unit) => Number(ok(await t.owner.get(`/product-prices?productId=${pid}`)).find((p) => p.unitName === unit).rate);

    const pv = ok(await t.owner.post('/product-prices/change', { productIds: ids, percent: 10, preview: true }));
    expect(pv.applied).toBe(false);
    expect(pv.rows.filter((r) => r.productId === a.product.id).map((r) => [r.unitName, Number(r.from), Number(r.to)])).toEqual([['BOTTLE', 125, 138], ['CARTON', 750, 825]]);
    expect(await rate(a.product.id, 'CARTON')).toBe(750); // preview changes nothing

    ok(await t.owner.post('/product-prices/change', { productIds: ids, amount: 60, unitName: 'CARTON' }));
    expect(await rate(a.product.id, 'CARTON')).toBe(810);
    expect(await rate(b.product.id, 'BOTTLE')).toBe(135); // +60 a peti = +10 a bottle

    expect((await t.owner.post('/product-prices/change', { productIds: ids, amount: 60 })).status).toBe(400); // unit needed
    expect((await t.owner.post('/product-prices/change', { productIds: ids, percent: 5, amount: 5, unitName: 'CARTON' })).status).toBe(400);
    expect((await t.owner.post('/product-prices/change', { productIds: ids, amount: -2000, unitName: 'CARTON' })).status).toBe(400); // below zero
  });
});
