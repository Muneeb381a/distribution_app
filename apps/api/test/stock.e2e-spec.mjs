import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld } from './helpers.mjs';

let t, w;
beforeAll(async () => {
  t = await boot();
  w = await stockedWorld(t.owner, 10); // 60 bottles in the godown
});
afterAll(() => t.close());

const transfer = (cartons) => t.owner.post('/stock/transfers', {
  fromLocationId: w.godown.id, toLocationId: w.shop.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: cartons }],
});

describe('stock', () => {
  it('a purchase puts stock in and records what the supplier is owed', async () => {
    expect(await w.stockOf(w.godown.id)).toBe(60);
    const ledger = ok(await t.owner.get(`/suppliers/${w.supplier.id}/ledger`));
    expect(Number(ledger.balance)).toBe(4000); // 10 x 600 = 6000, paid 2000
  });

  it('stock never goes below zero, even with transfers racing each other', async () => {
    // 10 cartons available; three transfers of 4 cartons arrive at the same moment, so only two can fit.
    const results = await Promise.all([transfer(4), transfer(4), transfer(4)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 400]);
    expect(await w.stockOf(w.godown.id)).toBe(12);
    expect(await w.stockOf(w.shop.id)).toBe(48);
  });

  it('refuses to move more than there is', async () => {
    expect((await transfer(3)).status).toBe(400);
    expect(await w.stockOf(w.godown.id)).toBe(12);
  });

  it('damaged stock is counted separately and written off with a reason', async () => {
    const adjust = (kind, qty, note = 'broken in transit') => t.owner.post('/stock/adjustments', {
      locationId: w.godown.id, productId: w.product.id, unitName: 'BOTTLE', qty, kind, note,
    });
    expect((await adjust('MARK_DAMAGED', 2)).status).toBe(201);
    expect(await w.stockOf(w.godown.id)).toBe(10);
    expect(await w.stockOf(w.godown.id, 'damaged')).toBe(2);
    expect((await adjust('WRITE_OFF_DAMAGED', 2)).status).toBe(201);
    expect(await w.stockOf(w.godown.id, 'damaged')).toBe(0);
    expect((await adjust('REMOVE', 1, 'x')).status).toBe(400); // a reason of at least 3 characters is required
  });

  it('empties owed to a supplier are tracked and can be cancelled', async () => {
    const entry = (direction, qty) => t.owner.post('/supplier-empties', { supplierId: w.supplier.id, productId: w.product.id, direction, qty });
    ok(await entry('RECEIVED', 24));
    const returned = ok(await entry('RETURNED', 10));
    let owed = ok(await t.owner.get(`/supplier-empties?supplierId=${w.supplier.id}`)).owed;
    expect(owed[0].owed).toBe(14);
    ok(await t.owner.post(`/supplier-empties/${returned.id}/cancel`));
    owed = ok(await t.owner.get(`/supplier-empties?supplierId=${w.supplier.id}`)).owed;
    expect(owed[0].owed).toBe(24);
    expect((await entry('RECEIVED', 0)).status).toBe(400);
  });
});
