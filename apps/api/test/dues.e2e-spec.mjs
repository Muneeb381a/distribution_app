import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('who to chase (khata dues)', () => {
  it('lists customers who owe, with the age of the debt, and notes reminders', async () => {
    const w = await stockedWorld(t.owner, 20);
    const owes = ok(await t.owner.post('/customers', { name: uniq('Owes'), type: 'CREDIT', creditLimit: 100000, openingBalance: 1000, phone: '0300-1234567' }));
    const clear = ok(await t.owner.post('/customers', { name: uniq('Clear'), type: 'CREDIT', creditLimit: 100000 }));
    const bill = (customerId, paidNow) => ({ saleType: 'COUNTER', customerId, locationId: w.godown.id, paidNow, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 2 }] });
    ok(await t.owner.post('/sales', bill(owes.id, 0)));
    ok(await t.owner.post('/sales', bill(clear.id, 1500)));

    const dues = ok(await t.owner.get('/khata/dues'));
    const row = dues.rows.find((r) => r.id === owes.id);
    expect(row).toBeTruthy();
    expect(Number(row.balance)).toBe(2500);
    expect(Number(row.buckets.brought)).toBe(1000);
    expect(Number(row.buckets.d30)).toBe(1500);
    expect(row.oldestDays).toBe(0);
    expect(row.phone).toBe('0300-1234567');
    expect(row.lastReminded).toBeNull();
    expect(dues.rows.some((r) => r.id === clear.id)).toBe(false); // nothing owed, nothing to chase
    expect(Number(dues.totals.due)).toBeGreaterThanOrEqual(2500);

    ok(await t.owner.post(`/khata/${owes.id}/reminders`, { channel: 'WHATSAPP' }));
    const again = ok(await t.owner.get('/khata/dues')).rows.find((r) => r.id === owes.id);
    expect(again.lastReminded.channel).toBe('WHATSAPP');

    expect((await t.owner.post(`/khata/${owes.id}/reminders`, { channel: 'PIGEON' })).status).toBe(400);
    expect((await t.owner.post('/khata/11111111-1111-4111-8111-111111111111/reminders', { channel: 'CALL' })).status).toBe(404);
  });
});
