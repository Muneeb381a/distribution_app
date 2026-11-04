import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const preview = async (employeeId, month) => ok(await t.owner.get(`/payroll/preview?employeeId=${employeeId}&month=${month}`));
const mark = (employeeId, date, status) => t.owner.put('/attendance', { date, entries: [{ employeeId, status }] });
const num = (v) => Number(v);

describe('payroll', () => {
  let sam;
  it('monthly staff lose a thirtieth of salary per absent day, and half for a half day', async () => {
    sam = ok(await t.owner.post('/employees', { name: uniq('Sam'), type: 'MONTHLY', monthlySalary: 30000 }));
    for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) ok(await mark(sam.id, d, 'ABSENT'));
    ok(await mark(sam.id, '2026-10-04', 'HALF_DAY'));
    ok(await t.owner.post('/advances', { employeeId: sam.id, amount: 1000, date: '2026-10-05' }));
    ok(await t.owner.post('/advances', { employeeId: sam.id, amount: 2000, date: '2026-10-15' }));
    const p = await preview(sam.id, '2026-10');
    expect(num(p.absenceDeduction)).toBe(3500); // 3.5 days x 1000
    expect(num(p.gross)).toBe(26500);
    expect(num(p.advances)).toBe(3000);
    expect(num(p.netPaid)).toBe(23500);
  });

  it('finalising posts the salary expense once, deducts the advances and locks attendance', async () => {
    ok(await t.owner.post('/payroll/run', { employeeId: sam.id, month: '2026-10' }));
    expect((await t.owner.post('/payroll/run', { employeeId: sam.id, month: '2026-10' })).status).toBe(409);
    expect((await mark(sam.id, '2026-10-02', 'PRESENT')).status).toBe(400);
    const expenses = ok(await t.owner.get('/expenses?category=Salaries&from=2026-10-01&to=2026-10-31'));
    const mine = expenses.filter((e) => e.note?.startsWith(sam.name));
    expect(mine).toHaveLength(1);
    expect(num(mine[0].amount)).toBe(26500);
  });

  it('cancelling a run frees the advances and the month can be run again', async () => {
    const run = (await preview(sam.id, '2026-10')).alreadyRun;
    expect((await t.owner.post(`/payroll/${run.id}/cancel`, {})).status).toBe(400); // a reason is required
    expect((await t.owner.post(`/payroll/${run.id}/cancel`, { reason: 'wrong attendance' })).status).toBe(201);
    const p = await preview(sam.id, '2026-10');
    expect(p.alreadyRun).toBeNull();
    expect(num(p.advances)).toBe(3000);
    const expenses = ok(await t.owner.get('/expenses?category=Salaries&from=2026-10-01&to=2026-10-31'));
    expect(expenses.filter((e) => e.note?.startsWith(sam.name) && e.status === 'ACTIVE')).toHaveLength(0);
    expect((await mark(sam.id, '2026-10-02', 'PRESENT')).status).toBe(200);
    ok(await t.owner.post('/payroll/run', { employeeId: sam.id, month: '2026-10' }));
  });

  it('advances beyond what was earned carry into the next month', async () => {
    const dan = ok(await t.owner.post('/employees', { name: uniq('Dan'), type: 'DAILY', dailyWage: 1000 }));
    for (let d = 1; d <= 20; d++) ok(await mark(dan.id, `2026-09-${String(d).padStart(2, '0')}`, 'PRESENT'));
    ok(await t.owner.post('/advances', { employeeId: dan.id, amount: 30000, date: '2026-09-10' }));
    const sep = await preview(dan.id, '2026-09');
    expect(num(sep.gross)).toBe(20000);
    expect(num(sep.netPaid)).toBe(0);
    expect(num(sep.carryOut)).toBe(10000);
    ok(await t.owner.post('/payroll/run', { employeeId: dan.id, month: '2026-09' }));
    for (let d = 1; d <= 15; d++) ok(await mark(dan.id, `2026-10-${String(d).padStart(2, '0')}`, 'PRESENT'));
    const oct = await preview(dan.id, '2026-10');
    expect(num(oct.carryIn)).toBe(10000);
    expect(num(oct.netPaid)).toBe(5000); // 15000 earned - 10000 carried
    // September cannot be cancelled while October depends on it
    ok(await t.owner.post('/payroll/run', { employeeId: dan.id, month: '2026-10' }));
    const sepRun = (await preview(dan.id, '2026-09')).alreadyRun;
    expect((await t.owner.post(`/payroll/${sepRun.id}/cancel`, { reason: 'too early' })).status).toBe(400);
  });

  it('a finalised month shows what was actually paid', async () => {
    const p = await preview(sam.id, '2026-10');
    expect(p.alreadyRun).toBeTruthy();
    // the earlier test corrected 2 Oct to present: 2.5 absent days = 2500 off, 3000 of advances
    expect(num(p.absenceDeduction)).toBe(2500);
    expect(num(p.netPaid)).toBe(24500);
  });
});
