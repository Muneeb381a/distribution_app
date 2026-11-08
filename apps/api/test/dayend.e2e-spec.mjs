import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => Number(v);

describe('day end: the cash drawer', () => {
  it('works out what the drawer should hold, and records the count and the difference', async () => {
    // other test files share this database and the same day, so measure what changes rather than the totals
    const before = ok(await t.owner.get(`/day-end?date=${today()}`));
    const w = await stockedWorld(t.owner, 20);
    const c = ok(await t.owner.post('/customers', { name: uniq('Shop'), type: 'CREDIT', creditLimit: 100000 }));
    const bill = (customerId, paidNow, method) => ({ saleType: 'COUNTER', ...(customerId ? { customerId } : {}), locationId: w.godown.id, paidNow, method, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 2 }] });
    ok(await t.owner.post('/sales', bill(c.id, 500, 'CASH')));          // cash with a bill
    ok(await t.owner.post('/sales', bill(undefined, 1500, 'CASH')));    // walk-in cash sale
    ok(await t.owner.post('/sales', bill(c.id, 700, 'BANK')));          // bank money is not in the drawer
    ok(await t.owner.post('/payments', { customerId: c.id, amount: 300, method: 'CASH' }));
    ok(await t.owner.post('/expenses', { category: uniq('Tea'), amount: 120, date: today() }));

    const day = ok(await t.owner.get(`/day-end?date=${today()}`));
    expect(num(day.cashIn.total) - num(before.cashIn.total)).toBe(2300);   // 500 + 1500 + 300
    expect(num(day.otherIn.total) - num(before.otherIn.total)).toBe(700);
    expect(num(day.cashOut.total) - num(before.cashOut.total)).toBe(2120); // the 2,000 paid on the purchase + 120 tea
    expect(day.bills.count - before.bills.count).toBe(3);
    expect(day.closed).toBeNull();

    // no earlier count yet: the opening cash has to be given
    expect((await t.owner.put('/day-end', { date: today(), counted: 2000 })).status).toBe(400);
    // other test files add cash out on the same day, so start from a drawer big enough to stay above zero
    const OPENING = 10_000_000;
    const expectedCash = OPENING + num(day.cashIn.total) - num(day.cashOut.total);
    const closed = ok(await t.owner.put('/day-end', { date: today(), counted: expectedCash - 80, openingCash: OPENING }));
    expect(num(closed.expected)).toBe(expectedCash);
    expect(num(closed.difference)).toBe(-80); // counted 80 short

    // closing again replaces the count; the opening figure of a closed day does not move
    const again = ok(await t.owner.put('/day-end', { date: today(), counted: expectedCash, openingCash: 999, note: 'recounted' }));
    expect(num(again.openingCash)).toBe(OPENING);
    expect(num(again.difference)).toBe(0);
    expect(ok(await t.owner.get(`/day-end?date=${today()}`)).closed.note).toBe('recounted');

    const history = ok(await t.owner.get('/day-end/history'));
    expect(history[0].closedBy).toBe('owner');
  });

  it('rejects a day that has not happened and a bad date', async () => {
    expect((await t.owner.put('/day-end', { date: '2999-01-01', counted: 0, openingCash: 0 })).status).toBe(400);
    expect((await t.owner.get('/day-end?date=yesterday')).status).toBe(400);
  });
});
