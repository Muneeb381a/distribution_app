import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('profit report', () => {
  it('expenses are not split by line: they come off the combined profit and are totalled by godown / shop', async () => {
    const locations = ok(await t.owner.get('/locations'));
    const godown = locations.find((l) => l.type === 'GODOWN');
    const vehicle = locations.find((l) => l.type === 'VEHICLE');
    const day = '2025-03-03';
    ok(await t.owner.post('/expenses', { date: day, category: 'Rent', amount: 3000, locationId: godown.id }));
    ok(await t.owner.post('/expenses', { date: day, category: 'Electricity', amount: 1200 }));
    if (vehicle) expect((await t.owner.post('/expenses', { date: day, category: 'Fuel', amount: 10, locationId: vehicle.id })).status).toBe(400);

    const r = ok(await t.owner.get(`/reports/profit?from=${day}&to=${day}&groupBy=none`));
    const row = r.rows[0];
    expect(Number(row.total.expenses)).toBe(4200);
    expect(Number(row.total.netProfit)).toBe(Number(row.total.grossProfit) - 4200);
    expect(row.lines.BOTTLES.expenses).toBeUndefined();
    expect(row.lines.RICE.netProfit).toBeUndefined();
    expect(r.expensesByPlace.map((p) => [p.name, Number(p.amount)])).toEqual([[godown.name, 3000], ['General', 1200]]);
    expect(r.expensesByCategory[0]).toMatchObject({ category: 'Rent' });

    const onlyGodown = ok(await t.owner.get(`/expenses?from=${day}&to=${day}&locationId=${godown.id}`));
    expect(onlyGodown.map((e) => e.category)).toEqual(['Rent']);
    expect(onlyGodown[0].location.name).toBe(godown.name);
    const general = ok(await t.owner.get(`/expenses?from=${day}&to=${day}&locationId=none`));
    expect(general.map((e) => e.category)).toEqual(['Electricity']);
  });
});
