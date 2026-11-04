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

  it('an advance bigger than the salary is cut up to what was earned; the rest stays owed', async () => {
    const dan = ok(await t.owner.post('/employees', { name: uniq('Dan'), type: 'DAILY', dailyWage: 1000 }));
    for (let d = 1; d <= 20; d++) ok(await mark(dan.id, `2026-09-${String(d).padStart(2, '0')}`, 'PRESENT'));
    const adv = ok(await t.owner.post('/advances', { employeeId: dan.id, amount: 30000, date: '2026-09-10' }));
    const sep = await preview(dan.id, '2026-09');
    expect(num(sep.gross)).toBe(20000);
    expect(num(sep.advances)).toBe(20000);
    expect(num(sep.netPaid)).toBe(0); // never negative
    expect(num(sep.owedAfter)).toBe(10000);
    ok(await t.owner.post('/payroll/run', { employeeId: dan.id, month: '2026-09' }));
    expect(num(ok(await t.owner.get(`/advances/${adv.id}`)).remaining)).toBe(10000);
    for (let d = 1; d <= 15; d++) ok(await mark(dan.id, `2026-10-${String(d).padStart(2, '0')}`, 'PRESENT'));
    const oct = await preview(dan.id, '2026-10');
    expect(num(oct.advances)).toBe(10000);
    expect(num(oct.netPaid)).toBe(5000); // 15000 earned - 10000 still owed
    // September cannot be cancelled while October depends on it
    ok(await t.owner.post('/payroll/run', { employeeId: dan.id, month: '2026-10' }));
    const sepRun = (await preview(dan.id, '2026-09')).alreadyRun;
    expect((await t.owner.post(`/payroll/${sepRun.id}/cancel`, { reason: 'too early' })).status).toBe(400);
  });

  it('an advance with a monthly instalment is cut a part each month, and cancelling a month gives the cut back', async () => {
    const ali = ok(await t.owner.post('/employees', { name: uniq('Ali'), type: 'MONTHLY', monthlySalary: 40000 }));
    expect((await t.owner.post('/advances', { employeeId: ali.id, amount: 5000, installment: 6000 })).status).toBe(400);
    const adv = ok(await t.owner.post('/advances', { employeeId: ali.id, amount: 25000, installment: 10000, date: '2026-07-20', note: 'Wedding' }));

    const jul = await preview(ali.id, '2026-07');
    expect(num(jul.advances)).toBe(10000);
    expect(num(jul.netPaid)).toBe(30000);
    expect(num(jul.owedAfter)).toBe(15000);
    const julRun = ok(await t.owner.post('/payroll/run', { employeeId: ali.id, month: '2026-07' }));

    // the owner skips August's cut (deductions override), then September takes the instalment again
    const aug = await preview(ali.id, '2026-08');
    expect(num(aug.cuts[0].planned)).toBe(10000);
    expect((await t.owner.post('/payroll/run', { employeeId: ali.id, month: '2026-08', deductions: [{ advanceId: adv.id, amount: 16000 }] })).status).toBe(400); // more than is left
    const augRun = ok(await t.owner.post('/payroll/run', { employeeId: ali.id, month: '2026-08', deductions: [{ advanceId: adv.id, amount: 0 }] }));
    expect(num(augRun.netPaid)).toBe(40000);

    // he hands back 2000 in cash
    const cash = ok(await t.owner.post(`/advances/${adv.id}/repay`, { amount: 2000, date: '2026-09-02' }));
    expect((await t.owner.post(`/advances/${adv.id}/repay`, { amount: 99999 })).status).toBe(400);
    const sep = await preview(ali.id, '2026-09');
    expect(num(sep.advances)).toBe(10000);
    expect(num(sep.owedAfter)).toBe(3000);
    ok(await t.owner.post('/payroll/run', { employeeId: ali.id, month: '2026-09' }));
    const oct = await preview(ali.id, '2026-10');
    expect(num(oct.advances)).toBe(3000); // only what is left, not the full instalment
    expect(num(oct.netPaid)).toBe(37000);

    const slip = ok(await t.owner.get(`/advances/${adv.id}`));
    // payroll cuts are dated the day the salary was paid; the cash repayment on its own date
    expect(slip.recoveries.map((r) => num(r.amount)).sort((a, b) => a - b)).toEqual([2000, 10000, 10000]);
    expect(num(slip.remaining)).toBe(3000);
    expect(slip.employee.name).toBe(ali.name);
    // a payroll cut cannot be undone from here, a cash repayment can
    const cut = slip.recoveries.find((r) => r.payrollRunId);
    expect((await t.owner.post(`/advances/recoveries/${cut.id}/cancel`, {})).status).toBe(400);
    expect((await t.owner.post(`/advances/${adv.id}/cancel`, {})).status).toBe(400); // partly recovered

    const ledger = ok(await t.owner.get(`/employees/${ali.id}/ledger`));
    expect(num(ledger.owed)).toBe(3000);
    expect(num(ledger.monthlyCut)).toBe(3000);
    expect(ledger.entries[0].kind).toBe('SALARY'); // newest first
    expect(ledger.entries.filter((e) => e.kind === 'CUT')).toHaveLength(2);

    // cancelling September (the latest run) puts its 10000 back on the advance
    const sepRun = (await preview(ali.id, '2026-09')).alreadyRun;
    ok(await t.owner.post(`/payroll/${sepRun.id}/cancel`, { reason: 'recalculate' }));
    expect(num(ok(await t.owner.get(`/advances/${adv.id}`)).remaining)).toBe(13000);
    ok(await t.owner.post(`/advances/recoveries/${cash.id}/cancel`, {}));
    expect(num(ok(await t.owner.get(`/advances/${adv.id}`)).remaining)).toBe(15000);
    expect(num(ok(await t.owner.get(`/employees/${ali.id}/ledger`)).owed)).toBe(15000);
    expect(julRun.id).toBeTruthy();
  });

  it('a finalised month shows what was actually paid', async () => {
    const p = await preview(sam.id, '2026-10');
    expect(p.alreadyRun).toBeTruthy();
    // the earlier test corrected 2 Oct to present: 2.5 absent days = 2500 off, 3000 of advances
    expect(num(p.absenceDeduction)).toBe(2500);
    expect(num(p.netPaid)).toBe(24500);
  });
});
