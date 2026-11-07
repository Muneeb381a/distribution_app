import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const preview = async (employeeId, month) => ok(await t.owner.get(`/payroll/preview?employeeId=${employeeId}&month=${month}`));
const mark = (employeeId, date, status) => t.owner.put('/attendance', { date, entries: [{ employeeId, status }] });
const num = (v) => Number(v);
const FRIDAY = 5;

// September 2026: Fridays are the 4th, 11th, 18th and 25th.
describe('holidays and weekly off', () => {
  let monthly, other, daily, holiday;

  it('a holiday is a day off for everyone, and can be removed again', async () => {
    const added = ok(await t.owner.post('/holidays', { name: 'Test holiday', date: '2026-09-10' }));
    holiday = added.holidays[0];
    expect(added.holidays).toHaveLength(1);
    const list = ok(await t.owner.get('/holidays?from=2026-09-01&to=2026-09-30'));
    expect(list.map((h) => h.date.slice(0, 10))).toEqual(['2026-09-10']);

    expect((await t.owner.post('/holidays', { name: 'Backwards', date: '2026-09-12', toDate: '2026-09-11' })).status).toBe(400);
    const range = ok(await t.owner.post('/holidays', { name: 'Three days', date: '2026-09-20', toDate: '2026-09-22' }));
    expect(range.holidays).toHaveLength(3);
    for (const h of range.holidays) ok(await t.owner.delete(`/holidays/${h.id}`));
    expect(ok(await t.owner.get('/holidays?from=2026-09-01&to=2026-09-30'))).toHaveLength(1);
  });

  it('a monthly salary is not cut for a holiday or the weekly off, only for a normal day', async () => {
    monthly = ok(await t.owner.post('/employees', { name: uniq('Monthly'), type: 'MONTHLY', monthlySalary: 30000 }));
    ok(await t.owner.put('/weekly-off', { weeklyOff: FRIDAY, employeeIds: [monthly.id] }));
    ok(await mark(monthly.id, '2026-09-04', 'ABSENT')); // a Friday: weekly off
    ok(await mark(monthly.id, '2026-09-10', 'ABSENT')); // the holiday
    ok(await mark(monthly.id, '2026-09-07', 'ABSENT')); // an ordinary Monday
    const p = await preview(monthly.id, '2026-09');
    expect(num(p.absenceDeduction)).toBe(1000);
    expect(p.details.attendance.absent).toBe(1);
    expect(p.details.attendance.holidays).toBe(1);
    expect(p.details.attendance.weeklyOffs).toBe(4);
  });

  it('a daily wage is not paid for days off unless the person worked', async () => {
    daily = ok(await t.owner.post('/employees', { name: uniq('Daily'), type: 'DAILY', dailyWage: 1000 }));
    ok(await t.owner.put('/weekly-off', { weeklyOff: FRIDAY, employeeIds: [daily.id] }));
    ok(await mark(daily.id, '2026-09-02', 'PRESENT'));
    ok(await mark(daily.id, '2026-09-03', 'PRESENT'));
    ok(await mark(daily.id, '2026-09-11', 'PRESENT')); // worked on a Friday: normal wage, no extra
    const p = await preview(daily.id, '2026-09');
    expect(num(p.base)).toBe(3000);
    expect(p.details.attendance.workedOnOff).toBe(1);
  });

  it('a holiday can cover only chosen employees', async () => {
    other = ok(await t.owner.post('/employees', { name: uniq('Other'), type: 'MONTHLY', monthlySalary: 30000 }));
    ok(await t.owner.post('/holidays', { name: 'Only for one', date: '2026-09-14', employeeIds: [monthly.id] }));
    ok(await mark(monthly.id, '2026-09-14', 'ABSENT'));
    ok(await mark(other.id, '2026-09-14', 'ABSENT'));
    expect(num((await preview(monthly.id, '2026-09')).absenceDeduction)).toBe(1000); // unchanged
    expect(num((await preview(other.id, '2026-09')).absenceDeduction)).toBe(1000);
    expect((await t.owner.post('/holidays', { name: 'Ghost', date: '2026-09-15', employeeIds: ['11111111-1111-4111-8111-111111111111'] })).status).toBe(400);
  });

  it('setting the weekly off for everyone, clearing it, and warning about payroll already final', async () => {
    const all = ok(await t.owner.put('/weekly-off', { weeklyOff: 0 }));
    expect(all.updated).toBeGreaterThan(2);
    ok(await t.owner.put('/weekly-off', { weeklyOff: null }));
    expect((await t.owner.put('/weekly-off', { weeklyOff: 9 })).status).toBe(400);
    ok(await t.owner.post('/payroll/run', { employeeId: other.id, month: '2026-09' }));
    const late = ok(await t.owner.post('/holidays', { name: 'Added late', date: '2026-09-28' }));
    expect(late.finalised).toBeGreaterThan(0);
    expect(late.finalisedMonths).toContain('2026-09');
    expect(holiday.id).toBeTruthy();
  });
});
