import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const dash = async () => ok(await t.owner.get('/dashboard/summary'));

describe('a supplier that has been hidden', () => {
  it('stops counting in what we owe, can still be found and fixed, and can come back', async () => {
    const before = Number((await dash()).payable);
    const s = ok(await t.owner.post('/suppliers', { name: uniq('Bhatti Traders'), type: 'RICE_MILL', openingBalance: 600000 }));
    expect(Number((await dash()).payable)).toBe(before + 600000);

    // the "delete" button only hides: the dashboard follows the supplier list, which no longer shows it
    ok(await t.owner.patch(`/suppliers/${s.id}`, { isActive: false }));
    expect(Number((await dash()).payable)).toBe(before);
    expect(ok(await t.owner.get('/suppliers')).some((x) => x.id === s.id)).toBe(false);
    expect(ok(await t.owner.get('/suppliers/balances')).some((x) => x.id === s.id)).toBe(false);

    // but it can be found again, with what is still owed, and corrected
    const all = ok(await t.owner.get('/suppliers?includeInactive=true'));
    const row = all.find((x) => x.id === s.id);
    expect(row).toMatchObject({ isActive: false });
    expect(Number(row.balance)).toBe(600000);
    ok(await t.owner.patch(`/suppliers/${s.id}`, { openingBalance: 0 }));
    expect(Number(ok(await t.owner.get('/suppliers?includeInactive=true')).find((x) => x.id === s.id).balance)).toBe(0);

    // switching it back on counts it again
    ok(await t.owner.patch(`/suppliers/${s.id}`, { openingBalance: 250000, isActive: true }));
    expect(Number((await dash()).payable)).toBe(before + 250000);
    expect(ok(await t.owner.get('/suppliers')).some((x) => x.id === s.id)).toBe(true);
  });

  it('counts purchases and payments in its balance, hidden or not', async () => {
    const s = ok(await t.owner.post('/suppliers', { name: uniq('Mill'), openingBalance: 1000 }));
    const locs = ok(await t.owner.get('/locations'));
    const godown = locs.find((l) => l.type === 'GODOWN');
    const cat = ok(await t.owner.get('/categories?line=BOTTLES'))[0];
    const p = ok(await t.owner.post('/products', { categoryId: cat.id, name: uniq('Cola'), size: '1 L', baseUnit: 'BOTTLE', units: [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: 6 }] }));
    ok(await t.owner.post('/purchases', { supplierId: s.id, locationId: godown.id, paidNow: 300, items: [{ productId: p.id, unitName: 'CARTON', qty: 2, unitPrice: 500 }] }));
    ok(await t.owner.patch(`/suppliers/${s.id}`, { isActive: false }));
    const row = ok(await t.owner.get('/suppliers?includeInactive=true')).find((x) => x.id === s.id);
    // opening 1000 + purchase 1000 - paid now 300
    expect(Number(row.balance)).toBe(1700);
  });
});

describe('a customer that has been hidden', () => {
  it('stops counting in what customers owe, and can still be found with the balance', async () => {
    const before = Number((await dash()).khata.receivable);
    const totalBefore = (await dash()).khata.customersTotal;
    const c = ok(await t.owner.post('/customers', { name: uniq('Ibad'), type: 'CREDIT', creditLimit: 900000, openingBalance: 400000 }));
    expect(Number((await dash()).khata.receivable)).toBe(before + 400000);
    expect((await dash()).khata.customersTotal).toBe(totalBefore + 1);
    ok(await t.owner.patch(`/customers/${c.id}`, { isActive: false }));
    expect((await dash()).khata.customersTotal).toBe(totalBefore);
    expect(Number((await dash()).khata.receivable)).toBe(before);
    expect(ok(await t.owner.get('/customers')).some((x) => x.id === c.id)).toBe(false);
    const row = ok(await t.owner.get('/customers?includeInactive=true')).find((x) => x.id === c.id);
    expect(row).toMatchObject({ isActive: false });
    expect(Number(row.balance)).toBe(400000);
    ok(await t.owner.patch(`/customers/${c.id}`, { isActive: true }));
    expect(Number((await dash()).khata.receivable)).toBe(before + 400000);
  });

  it('counts a new udhaar customer at once, even with nothing owed yet', async () => {
    const before = (await dash()).khata;
    ok(await t.owner.post('/customers', { name: uniq('New udhaar'), type: 'CREDIT', creditLimit: 50000 }));
    const after = (await dash()).khata;
    expect(after.customersTotal).toBe(before.customersTotal + 1);
    expect(Number(after.receivable)).toBe(Number(before.receivable));
    expect(after.customersOwing).toBe(before.customersOwing);
  });
});
