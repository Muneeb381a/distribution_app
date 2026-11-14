import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const units = (p) => Object.fromEntries(p.units.map((u) => [u.unitName, Number(u.factorToBase)]));

describe('add products from the catalog', () => {
  it('creates drinks with their peti size and categories, and skips them the second time', async () => {
    const brand = uniq('Cola');
    const items = [
      { line: 'BOTTLES', path: ['Juices', brand], name: `${brand} Mango`, brand: 'Test Co', size: '200 ml', packSize: 24, bagKg: null, returnableEmpty: false },
      { line: 'BOTTLES', path: ['Juices', brand], name: `${brand} Mango`, brand: 'Test Co', size: '1 L', packSize: 12, bagKg: null, returnableEmpty: false },
      { line: 'BOTTLES', path: [brand], name: brand, brand: 'Test Co', size: '250 ml glass', packSize: 24, bagKg: null, returnableEmpty: true },
    ];
    const first = ok(await t.owner.post('/products/bulk', { items }));
    expect(first.created.length).toBe(3);
    expect(first.skipped.length).toBe(0);
    const again = ok(await t.owner.post('/products/bulk', { items }));
    expect(again.created.length).toBe(0);
    expect(again.skipped.length).toBe(3);

    const products = ok(await t.owner.get('/products?line=BOTTLES')).filter((p) => p.name.startsWith(brand));
    expect(products.length).toBe(3);
    const glass = products.find((p) => p.size === '250 ml glass');
    expect(units(glass)).toEqual({ BOTTLE: 1, CARTON: 24 });
    expect(glass.returnableEmpty).toBe(true);
    expect(units(products.find((p) => p.size === '1 L'))).toEqual({ BOTTLE: 1, CARTON: 12 });

    const cats = ok(await t.owner.get('/categories?line=BOTTLES'));
    const juices = cats.find((c) => c.name === 'Juices' && !c.parentId);
    expect(cats.some((c) => c.name === brand && c.parentId === juices.id)).toBe(true);
  });

  it('creates loose rice (kg, maund, 50 kg bori) and packed bags (kg, bag)', async () => {
    const variety = uniq('Kernel');
    const items = [
      { line: 'RICE', path: ['Basmati', variety, 'Sella'], name: `${variety} Sella`, brand: null, size: null, packSize: 1, bagKg: 50, returnableEmpty: false, isPacked: false },
      { line: 'RICE', path: ['Basmati', variety, 'Sella'], name: `${variety} Sella`, brand: null, size: '5 kg bag', packSize: 1, bagKg: 5, returnableEmpty: false, isPacked: true },
    ];
    expect(ok(await t.owner.post('/products/bulk', { items })).created.length).toBe(2);
    const rice = ok(await t.owner.get('/products?line=RICE')).filter((p) => p.name === `${variety} Sella`);
    expect(units(rice.find((p) => !p.size))).toEqual({ KG: 1, MAUND: 40, BAG: 50 });
    const bag = rice.find((p) => p.size === '5 kg bag');
    expect(units(bag)).toEqual({ KG: 1, BAG: 5 });
    expect(bag.isPacked).toBe(true);
  });

  it('takes a 2 L size, a hand-made brand and an odd bag weight, then sets their rates like the catalog page does', async () => {
    const brand = uniq('Own Cola');
    const rice = uniq('Super Fine');
    const items = [
      { line: 'BOTTLES', path: [brand], name: brand, brand: 'Own Co', size: '2 L', packSize: 6, bagKg: null, returnableEmpty: false },
      { line: 'RICE', path: ['Basmati', rice, 'Sella'], name: `${rice} Sella`, brand: null, size: '12 kg bag', packSize: 1, bagKg: 12, returnableEmpty: false, isPacked: true },
      { line: 'RICE', path: ['Basmati', rice, 'Sella'], name: `${rice} Sella`, brand: null, size: null, packSize: 1, bagKg: 50, returnableEmpty: false, isPacked: false },
    ];
    const r = ok(await t.owner.post('/products/bulk', { items }));
    expect(r.created).toHaveLength(3);
    const id = (name, size) => r.created.find((c) => c.name.startsWith(name) && c.size === size).id;

    // the same rates the page works out: per peti and per bottle; per bag and per kg; per maund, kg and bori
    ok(await t.owner.put(`/product-prices/${id(brand, '2 L')}`, { prices: [{ unitName: 'CARTON', rate: 900 }, { unitName: 'BOTTLE', rate: 150 }] }));
    ok(await t.owner.put(`/product-prices/${id(rice, '12 kg bag')}`, { prices: [{ unitName: 'BAG', rate: 2400 }, { unitName: 'KG', rate: 200 }] }));
    ok(await t.owner.put(`/product-prices/${id(rice, null)}`, { prices: [{ unitName: 'MAUND', rate: 9000 }, { unitName: 'KG', rate: 225 }, { unitName: 'BAG', rate: 11250 }] }));

    const products = ok(await t.owner.get('/products')).filter((p) => p.name.startsWith(brand) || p.name.startsWith(rice));
    expect(units(products.find((p) => p.size === '2 L'))).toEqual({ BOTTLE: 1, CARTON: 6 });
    expect(units(products.find((p) => p.size === '12 kg bag'))).toEqual({ KG: 1, BAG: 12 });
    const prices = ok(await t.owner.get(`/product-prices?productId=${id(rice, null)}`));
    expect(prices.map((x) => [x.unitName, Number(x.rate)]).sort()).toEqual([['BAG', 11250], ['KG', 225], ['MAUND', 9000]]);
    // a 2 L bottle can be sold: it has a price list
    expect(ok(await t.owner.get(`/product-prices?productId=${id(brand, '2 L')}`))).toHaveLength(2);
  });

  it('needs the master-data permission and validates the rows', async () => {
    expect((await t.as().post('/products/bulk', { items: [] })).status).toBe(401);
    expect((await t.owner.post('/products/bulk', { items: [{ line: 'BOTTLES', path: [], name: 'x', packSize: 0, returnableEmpty: false }] })).status).toBe(400);
  });
});
