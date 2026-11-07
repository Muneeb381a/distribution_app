import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const today = () => new Date().toISOString().slice(0, 10);

describe('team activity: who sold, who took the money', () => {
  it('rolls bills and khata receipts up per person and lists their activity', async () => {
    const w = await stockedWorld(t.owner, 20);
    const salesman = ok(await t.owner.post('/employees', { name: uniq('Rafiq'), type: 'MONTHLY', monthlySalary: 30000, commissionPercent: 2 }));
    const c = ok(await t.owner.post('/customers', { name: uniq('Shop'), type: 'CREDIT', creditLimit: 100000 }));
    const bill = { saleType: 'COUNTER', customerId: c.id, salesmanId: salesman.id, locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 2 }] };
    ok(await t.owner.post('/sales', { ...bill, paidNow: 500, method: 'CASH' }));
    ok(await t.owner.post('/sales', { ...bill, paidNow: 0 }));
    const receipt = ok(await t.owner.post('/payments', { customerId: c.id, amount: 300, method: 'CASH' }));

    const team = ok(await t.owner.get(`/reports/team?from=${today()}&to=${today()}`));
    const rafiq = team.people.find((p) => p.key === `emp:${salesman.id}`);
    expect(rafiq).toBeTruthy();
    expect(rafiq.bills).toBe(2);
    expect(Number(rafiq.sales)).toBe(3000);
    expect(Number(rafiq.cashWithBills)).toBe(500);
    expect(Number(rafiq.udhaar)).toBe(2500);
    expect(Number(rafiq.commission)).toBe(60);
    // the khata receipt was taken by the owner's login, not by the salesman
    const owner = team.people.find((p) => p.username === 'owner');
    expect(Number(owner.receipts)).toBeGreaterThanOrEqual(300);
    expect(Number(team.totals.sales)).toBeGreaterThanOrEqual(3000);

    const act = ok(await t.owner.get(`/reports/team/activity?key=emp:${salesman.id}&from=${today()}&to=${today()}`));
    expect(act.bills).toHaveLength(2);
    expect(act.bills.every((b) => b.customer === c.name)).toBe(true);
    const ownerKey = owner.key;
    const ownerAct = ok(await t.owner.get(`/reports/team/activity?key=${ownerKey}&from=${today()}&to=${today()}`));
    expect(ownerAct.receipts.some((r) => r.receiptNo === receipt.receiptNo)).toBe(true);

    expect((await t.owner.get('/reports/team/activity?key=nonsense')).status).toBe(400);
  });
});
