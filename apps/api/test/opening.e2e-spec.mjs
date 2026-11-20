import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t, godown, shop, category;
beforeAll(async () => {
  t = await boot();
  const locs = ok(await t.owner.get('/locations'));
  godown = locs.find((l) => l.type === 'GODOWN');
  shop = locs.find((l) => l.type === 'SHOP');
  category = ok(await t.owner.get('/categories?line=BOTTLES'))[0];
});
afterAll(() => t.close());

/** A product that nobody has bought: no stock, no cost. */
async function newProduct(pack = 6) {
  const p = ok(await t.owner.post('/products', {
    categoryId: category.id, name: uniq('Old stock'), size: '1.5 L', baseUnit: 'BOTTLE',
    units: [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: pack }],
  }));
  ok(await t.owner.put(`/product-prices/${p.id}`, { prices: [{ unitName: 'BOTTLE', rate: 125 }, { unitName: 'CARTON', rate: 125 * pack }] }));
  return p;
}
const held = async (p, locationId) => {
  const rows = ok(await t.owner.get(`/stock?locationId=${locationId}&search=${encodeURIComponent(p.name)}`));
  return Number(rows.find((r) => r.productId === p.id)?.ok ?? 0);
};
const costOf = async (p) => {
  const rows = ok(await t.owner.get(`/stock?search=${encodeURIComponent(p.name)}`));
  const c = rows.find((r) => r.productId === p.id)?.latestUnitCost;
  return c == null ? null : Number(c);
};
const sheetRow = async (p, locationId) => ok(await t.owner.get(`/stock/opening/sheet?locationId=${locationId}`)).rows.find((r) => r.productId === p.id);

describe('stock the shop already had', () => {
  it('lists every product for a place with its units, what is recorded, and its cost', async () => {
    const p = await newProduct();
    const sheet = ok(await t.owner.get(`/stock/opening/sheet?locationId=${godown.id}`));
    expect(sheet.location).toMatchObject({ id: godown.id, type: 'GODOWN' });
    const row = sheet.rows.find((r) => r.productId === p.id);
    expect(row).toMatchObject({ baseUnit: 'BOTTLE', line: 'BOTTLES', recorded: '0', onHand: '0', cost: null });
    expect(row.units.map((u) => [u.unitName, Number(u.factorToBase)]).sort()).toEqual([['BOTTLE', 1], ['CARTON', 6]]);
    expect((await t.owner.get(`/stock/opening/sheet?locationId=${ok(await t.owner.post('/vehicles', { regNo: `OP-${Date.now() % 9000 + 1000}`, vehicleKind: 'PICKUP' })).id}`)).status).toBe(400);
  });

  it('puts stock in a godown and a shop with no supplier, and sets the cost', async () => {
    const p = await newProduct();
    const suppliers = ok(await t.owner.get('/suppliers')).length;
    const purchases = ok(await t.owner.get('/purchases')).length;
    const batch = ok(await t.owner.post('/stock/opening', {
      locationId: godown.id, note: 'Counted on opening day',
      lines: [{ productId: p.id, qtyBase: 10 * 6 + 3, unitCostBase: 100 }],
    }));
    expect(batch.openingNo).toMatch(/^OS-\d{6}$/);
    expect(Number(batch.totalValue)).toBe(63 * 100);
    expect(await held(p, godown.id)).toBe(63);
    expect(await costOf(p)).toBe(100);
    ok(await t.owner.post('/stock/opening', { locationId: shop.id, lines: [{ productId: p.id, qtyBase: 24 }] }));
    expect(await held(p, shop.id)).toBe(24);
    // it is stock history, not a purchase, and nobody is owed anything
    const moves = ok(await t.owner.get(`/stock/movements?productId=${p.id}`));
    expect(moves.map((m) => m.type)).toEqual(['OPENING', 'OPENING']);
    expect(moves.every((m) => m.refType === 'OPENING')).toBe(true);
    expect(ok(await t.owner.get('/suppliers')).length).toBe(suppliers);
    expect(ok(await t.owner.get('/purchases')).length).toBe(purchases);
  });

  it('a second count posts only the difference and shows what was recorded', async () => {
    const p = await newProduct();
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 60, unitCostBase: 90 }] }));
    expect((await sheetRow(p, godown.id)).recorded).toBe('60');
    const second = ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 72 }] }));
    expect(second.lines).toHaveLength(1);
    expect(Number(second.lines[0].qtyBase)).toBe(12);
    expect(Number(second.lines[0].openingAfter)).toBe(72);
    expect(await held(p, godown.id)).toBe(72);
    // counting lower takes the difference off
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 66 }] }));
    expect(await held(p, godown.id)).toBe(66);
    // nothing changed: nothing to save
    const same = await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 66 }] });
    expect(same.status).toBe(400);
    expect(JSON.stringify(same.body)).toMatch(/Nothing to save/);
  });

  it('refuses a recount that is lower than what has already been sold', async () => {
    const p = await newProduct();
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 30, unitCostBase: 100 }] }));
    ok(await t.owner.post('/sales', { saleType: 'COUNTER', locationId: godown.id, items: [{ productId: p.id, unitName: 'CARTON', qty: 4 }] }));
    expect(await held(p, godown.id)).toBe(6);
    const low = await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 10 }] });
    expect(low.status).toBe(400);
    expect(JSON.stringify(low.body)).toMatch(/Not enough/);
    expect(await held(p, godown.id)).toBe(6);
  });

  it('only changes the cost when a different one is typed, and a typed cost wins', async () => {
    const p = await newProduct();
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 12, unitCostBase: 80 }] }));
    expect(await costOf(p)).toBe(80);
    // same stock, new cost: a batch that only moves the cost
    const b = ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 12, unitCostBase: 95 }] }));
    expect(b.lines[0]).toMatchObject({ costChanged: true });
    expect(Number(b.lines[0].qtyBase)).toBe(0);
    expect(await costOf(p)).toBe(95);
  });

  it('can be dated earlier, so stock history starts on that day', async () => {
    const p = await newProduct();
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, asOf: '2026-01-05', lines: [{ productId: p.id, qtyBase: 18 }] }));
    const m = ok(await t.owner.get(`/stock/movements?productId=${p.id}`))[0];
    expect(new Date(m.createdAt).getFullYear()).toBe(2026);
    expect(new Date(m.createdAt).getMonth()).toBe(0);
    expect(new Date(m.createdAt).getDate()).toBe(5);
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    expect((await t.owner.post('/stock/opening', { locationId: godown.id, asOf: future, lines: [{ productId: p.id, qtyBase: 20 }] })).status).toBe(400);
  });
});

describe('undoing a save', () => {
  it('takes the quantities off and puts the cost back, and cannot be done twice', async () => {
    const p = await newProduct();
    ok(await t.owner.post('/stock/opening', { locationId: shop.id, lines: [{ productId: p.id, qtyBase: 12, unitCostBase: 70 }] }));
    const b = ok(await t.owner.post('/stock/opening', { locationId: shop.id, lines: [{ productId: p.id, qtyBase: 30, unitCostBase: 85 }] }));
    expect(await costOf(p)).toBe(85);
    const list = ok(await t.owner.get('/stock/openings'));
    expect(list.find((x) => x.id === b.id)).toMatchObject({ canReverse: true, status: 'ACTIVE', lineCount: 1 });

    ok(await t.owner.post(`/stock/openings/${b.id}/reverse`));
    expect(await held(p, shop.id)).toBe(12);
    expect(await costOf(p)).toBe(70);
    expect(ok(await t.owner.get(`/stock/openings/${b.id}`)).status).toBe('CANCELLED');
    expect((await t.owner.post(`/stock/openings/${b.id}/reverse`)).status).toBe(409);
    // the count after the undo starts again from what is really recorded
    expect((await sheetRow(p, shop.id)).recorded).toBe('12');
  });

  it('only the newest save of a place can be undone, and not when the stock has been sold', async () => {
    const p = await newProduct();
    const first = ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 24, unitCostBase: 100 }] }));
    const q = await newProduct();
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: q.id, qtyBase: 6 }] }));
    const early = await t.owner.post(`/stock/openings/${first.id}/reverse`);
    expect(early.status).toBe(400);
    expect(JSON.stringify(early.body)).toMatch(/reverse that first/);

    const r = await newProduct();
    const b = ok(await t.owner.post('/stock/opening', { locationId: shop.id, lines: [{ productId: r.id, qtyBase: 12, unitCostBase: 100 }] }));
    ok(await t.owner.post('/sales', { saleType: 'COUNTER', locationId: shop.id, items: [{ productId: r.id, unitName: 'CARTON', qty: 2 }] }));
    const sold = await t.owner.post(`/stock/openings/${b.id}/reverse`);
    expect(sold.status).toBe(400);
    expect(JSON.stringify(sold.body)).toMatch(/Not enough/);
    expect(await held(r, shop.id)).toBe(0);
  });
});

describe('costs that are missing', () => {
  it('lists products that have stock but no cost, and takes a cost for them', async () => {
    const p = await newProduct();
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 36 }] }));
    const missing = ok(await t.owner.get('/stock/opening/missing-costs'));
    const row = missing.find((m) => m.id === p.id);
    expect(row).toMatchObject({ baseUnit: 'BOTTLE' });
    expect(Number(row.onHand)).toBe(36);
    expect(ok(await t.owner.put('/stock/opening/costs', { items: [{ productId: p.id, unitCostBase: 105.5 }] })).updated).toBe(1);
    expect(await costOf(p)).toBe(105.5);
    expect(ok(await t.owner.get('/stock/opening/missing-costs')).some((m) => m.id === p.id)).toBe(false);
    // a product with no stock is not listed
    const empty = await newProduct();
    expect(ok(await t.owner.get('/stock/opening/missing-costs')).some((m) => m.id === empty.id)).toBe(false);
  });
});

describe('rules', () => {
  it('refuses a vehicle, an unknown product, a repeated product, a negative amount and an empty list', async () => {
    const p = await newProduct();
    const van = ok(await t.owner.post('/vehicles', { regNo: `ST-${Date.now() % 9000 + 1000}`, vehicleKind: 'VAN' }));
    expect((await t.owner.post('/stock/opening', { locationId: van.id, lines: [{ productId: p.id, qtyBase: 6 }] })).status).toBe(400);
    expect((await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: '00000000-0000-4000-8000-000000000000', qtyBase: 6 }] })).status).toBe(400);
    expect((await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 6 }, { productId: p.id, qtyBase: 7 }] })).status).toBe(400);
    expect((await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: -1 }] })).status).toBe(400);
    expect((await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 6, unitCostBase: 0 }] })).status).toBe(400);
    expect((await t.owner.post('/stock/opening', { locationId: godown.id, lines: [] })).status).toBe(400);
    expect(await held(p, godown.id)).toBe(0);
  });

  it('needs the stock-adjust permission', async () => {
    const roles = ok(await t.owner.get('/roles'));
    const cashier = roles.find((r) => r.name === 'Cashier');
    const username = `cash${Date.now().toString(36)}`;
    ok(await t.owner.post('/users', { username, password: 'cashier-pass-1', roleId: cashier.id }));
    const c = (await t.login(username, 'cashier-pass-1')).api;
    const p = await newProduct();
    expect((await c.get(`/stock/opening/sheet?locationId=${godown.id}`)).status).toBe(403);
    expect((await c.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 6 }] })).status).toBe(403);
    expect((await c.get('/stock/openings')).status).toBe(403);
    expect((await c.put('/stock/opening/costs', { items: [{ productId: p.id, unitCostBase: 5 }] })).status).toBe(403);
  });
});
