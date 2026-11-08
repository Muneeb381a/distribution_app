import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('expense categories', () => {
  it('starts with the usual list and the owner can add one with a colour', async () => {
    const list = ok(await t.owner.get('/expense-categories'));
    for (const n of ['Rent', 'Fuel', 'Salaries']) expect(list.some((c) => c.name === n)).toBe(true);
    expect(list.find((c) => c.name === 'Salaries').isSystem).toBe(true);

    const name = uniq('Tea and snacks');
    const c = ok(await t.owner.post('/expense-categories', { name: `  ${name}  `, color: '#F97316' }));
    expect(c).toMatchObject({ name, color: '#f97316', isActive: true, isSystem: false });
    expect(ok(await t.owner.get('/expenses/categories'))).toContain(name);
  });

  it('refuses a duplicate name however it is typed, and a bad colour', async () => {
    const name = uniq('Stationery');
    ok(await t.owner.post('/expense-categories', { name }));
    const dup = await t.owner.post('/expense-categories', { name: name.toUpperCase() });
    expect(dup.status).toBe(409);
    expect((await t.owner.post('/expense-categories', { name: uniq('X'), color: 'red' })).status).toBe(400);
    expect((await t.owner.post('/expense-categories', { name: '   ' })).status).toBe(400);
  });

  it('a category typed on an expense becomes part of the list', async () => {
    const name = uniq('Generator oil');
    ok(await t.owner.post('/expenses', { category: name, amount: 500 }));
    expect(ok(await t.owner.get('/expense-categories')).some((c) => c.name === name)).toBe(true);
  });

  it('renaming carries the old expenses along and shows what was spent', async () => {
    const before = uniq('Tea');
    const c = ok(await t.owner.post('/expense-categories', { name: before }));
    ok(await t.owner.post('/expenses', { category: before, amount: 250 }));
    ok(await t.owner.post('/expenses', { category: before, amount: 100 }));
    const row = ok(await t.owner.get('/expense-categories')).find((x) => x.id === c.id);
    expect(row.entries).toBe(2);
    expect(Number(row.total)).toBe(350);

    const after = uniq('Refreshments');
    ok(await t.owner.patch(`/expense-categories/${c.id}`, { name: after }));
    const entries = ok(await t.owner.get('/expenses'));
    expect(entries.filter((e) => e.category === after)).toHaveLength(2);
    expect(entries.some((e) => e.category === before)).toBe(false);
  });

  it('a hidden category leaves the picker and cannot be used until shown again', async () => {
    const name = uniq('Old habit');
    const c = ok(await t.owner.post('/expense-categories', { name }));
    ok(await t.owner.patch(`/expense-categories/${c.id}`, { isActive: false }));
    expect(ok(await t.owner.get('/expenses/categories'))).not.toContain(name);
    expect((await t.owner.post('/expenses', { category: name, amount: 10 })).status).toBe(400);
    expect((await t.owner.post('/expense-categories', { name })).status).toBe(409);
    ok(await t.owner.patch(`/expense-categories/${c.id}`, { isActive: true }));
    ok(await t.owner.post('/expenses', { category: name, amount: 10 }));
  });

  it('Salaries belongs to payroll: it cannot be renamed or hidden', async () => {
    const s = ok(await t.owner.get('/expense-categories')).find((c) => c.name === 'Salaries');
    expect((await t.owner.patch(`/expense-categories/${s.id}`, { name: 'Wages' })).status).toBe(400);
    expect((await t.owner.patch(`/expense-categories/${s.id}`, { isActive: false })).status).toBe(400);
    ok(await t.owner.patch(`/expense-categories/${s.id}`, { color: '#0ea5e9' }));
  });
});
