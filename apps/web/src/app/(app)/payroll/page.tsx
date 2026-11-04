'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BusyButton, Empty, SkeletonRows, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { LoadMore, usePaged } from '@/components/Table';
import { api } from '@/lib/api';

interface Option { id: string; name: string }
interface Preview {
  alreadyRun: { id: string; status?: string } | null;
  employee: { id: string; name: string; type: string };
  base: string; commission: string; absenceDeduction: string; gross: string; advances: string; carryIn: string; netPaid: string; carryOut: string;
}
interface Advance { id: string; date: string; amount: string; note: string | null; payrollRunId: string | null; status: string; employee: { name: string } }
interface Attendance { employeeId: string; date: string; status: string }

const STATUSES: [string, string, string][] = [
  ['PRESENT', 'Present', 'green'], ['ABSENT', 'Absent', 'red'], ['HALF_DAY', 'Half day', 'amber'], ['PAID_LEAVE', 'Paid leave', 'blue'], ['UNPAID_LEAVE', 'Unpaid leave', ''],
];
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const today = () => iso(new Date());
const n = (v: string | number) => Number(v).toLocaleString('en-PK', { maximumFractionDigits: 0 });
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

export default function PayrollPage() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [employees, setEmployees] = useState<Option[]>([]);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [advances, setAdvances] = useState<Advance[] | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [adv, setAdv] = useState({ employeeId: '', amount: '', date: today(), note: '' });
  const [attDate, setAttDate] = useState(today());
  const [att, setAtt] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const load = useCallback(async () => {
    try {
      const emps = await api<Option[]>('/employees/options');
      setEmployees(emps);
      const [pv, ad, at] = await Promise.all([
        Promise.all(emps.map((e) => api<Preview>(`/payroll/preview?employeeId=${e.id}&month=${month}`))),
        api<Advance[]>('/advances'),
        api<Attendance[]>(`/attendance?month=${attDate.slice(0, 7)}`),
      ]);
      setPreviews(pv);
      setAdvances(ad);
      setAttendance(at);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month, attDate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // What is already saved for the chosen day fills the form; unmarked staff default to present.
  useEffect(() => {
    const saved = Object.fromEntries(attendance.filter((a) => a.date.slice(0, 10) === attDate).map((a) => [a.employeeId, a.status]));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAtt(saved);
  }, [attendance, attDate]);
  const markedToday = attendance.some((a) => a.date.slice(0, 10) === attDate);

  // Days marked this month per employee, for the attendance summary.
  const monthCounts = useMemo(() => {
    const out: Record<string, Record<string, number>> = {};
    for (const a of attendance) (out[a.employeeId] ??= {})[a.status] = (out[a.employeeId]?.[a.status] ?? 0) + 1;
    return out;
  }, [attendance]);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(done);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const run = async (p: Preview) => {
    const ok = await confirm({
      title: `Finalise ${p.employee.name} for ${monthName(month)}?`,
      body: <p>Pay <b>Rs {n(p.netPaid)}</b>{Number(p.carryOut) ? <>, carry {n(p.carryOut)} to next month</> : null}. Advances are deducted and the salary is posted as an expense.</p>,
      confirmLabel: 'Finalise & pay',
    });
    if (!ok) return;
    return act(`run-${p.employee.id}`, () => api('/payroll/run', { method: 'POST', json: { employeeId: p.employee.id, month } }), `Payroll saved for ${p.employee.name}`);
  };

  const cancelRun = async (p: Preview) => {
    const reason = await prompt({
      title: `Cancel ${p.employee.name}'s payroll for ${monthName(month)}?`,
      body: <p>Advances become open again and the salary expense is cancelled.</p>,
      label: 'Reason',
      minLength: 3,
      confirmLabel: 'Cancel payroll',
      cancelLabel: 'Keep',
      danger: true,
    });
    if (!reason || reason.trim().length < 3) return;
    return act(`run-${p.employee.id}`, () => api(`/payroll/${p.alreadyRun!.id}/cancel`, { method: 'POST', json: { reason: reason.trim() } }), `Payroll cancelled for ${p.employee.name}`);
  };

  function addAdvance(e: FormEvent) {
    e.preventDefault();
    const name = employees.find((x) => x.id === adv.employeeId)?.name ?? '';
    return act('adv', async () => {
      await api('/advances', { method: 'POST', json: { employeeId: adv.employeeId, amount: Number(adv.amount), date: adv.date, note: adv.note || undefined } });
      setAdv({ ...adv, amount: '', note: '' });
    }, `Advance of Rs ${n(adv.amount)} recorded for ${name}`);
  }

  async function cancelAdvance(a: Advance) {
    if (!(await confirm({ title: 'Cancel this advance?', body: <p>Rs {n(a.amount)} to {a.employee.name} on {a.date.slice(0, 10)}.</p>, confirmLabel: 'Cancel advance', cancelLabel: 'Keep', danger: true }))) return;
    act(`a-${a.id}`, () => api(`/advances/${a.id}/cancel`, { method: 'POST', json: {} }), 'Advance cancelled');
  }

  const saveAttendance = () =>
    act(
      'att',
      () => api('/attendance', { method: 'PUT', json: { date: attDate, entries: employees.map((e) => ({ employeeId: e.id, status: att[e.id] ?? 'PRESENT' })) } }),
      `Attendance saved for ${new Date(`${attDate}T00:00:00`).toLocaleDateString('en-GB', { dateStyle: 'medium' })}`,
    );

  const totals = useMemo(() => {
    const p = previews ?? [];
    const done = p.filter((x) => x.alreadyRun);
    return {
      pay: p.reduce((s, x) => s + Number(x.netPaid), 0),
      paid: done.reduce((s, x) => s + Number(x.netPaid), 0),
      done: done.length,
      // Only months not yet finalised still have advances to take off.
      advances: p.filter((x) => !x.alreadyRun).reduce((s, x) => s + Number(x.advances) + Number(x.carryIn), 0),
    };
  }, [previews]);
  const openAdvances = (advances ?? []).filter((a) => a.status === 'ACTIVE' && !a.payrollRunId);
  const { page: advPage, loadMore: advMore } = usePaged(advances ?? [], 15);

  return (
    <>
      <div className="page-head">
        <div><h1>Payroll</h1><p>Salaries, commission, attendance and advances</p></div>
        <label className="field" style={{ minWidth: 200 }}>Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="stats">
        <div className="stat"><span className="label"><span className="icon"><Icon name="payroll" /></span>Pay for {monthName(month)}</span><span className="value"><small>Rs</small>{n(totals.pay)}</span><span className="sub">{previews?.length ?? 0} employees</span></div>
        <div className="stat"><span className="label"><span className="icon green"><Icon name="check" /></span>Finalised</span><span className="value">{totals.done} <small>of {previews?.length ?? 0}</small></span><span className="sub">Rs {n(totals.paid)} paid</span></div>
        <div className="stat"><span className="label"><span className="icon amber"><Icon name="wallet" /></span>Advances to deduct</span><span className="value"><small>Rs</small>{n(totals.advances)}</span><span className="sub">{openAdvances.length} open advances</span></div>
      </div>

      <h2>Salary for {monthName(month)}</h2>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th><th className="num">Base</th><th className="num">Commission</th><th className="num">Absence</th><th className="num">Gross</th>
            <th className="num">Advances</th><th className="num">Carried in</th><th className="num">Pay</th><th className="num">Carry to next</th><th>Status</th><th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {!previews && !error && <SkeletonRows cols={11} rows={3} />}
          {previews?.map((p) => (
            <tr key={p.employee.id}>
              <td><b>{p.employee.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{p.employee.type === 'DAILY' ? 'Daily wage' : 'Monthly salary'}</div></td>
              <td className="num">{n(p.base)}</td>
              <td className="num">{Number(p.commission) ? n(p.commission) : <span className="muted">—</span>}</td>
              <td className="num">{Number(p.absenceDeduction) ? <span className="amt-debit">-{n(p.absenceDeduction)}</span> : <span className="muted">—</span>}</td>
              <td className="num">{n(p.gross)}</td>
              <td className="num">{Number(p.advances) ? <span className="amt-debit">-{n(p.advances)}</span> : <span className="muted">—</span>}</td>
              <td className="num">{Number(p.carryIn) ? <span className="amt-debit">-{n(p.carryIn)}</span> : <span className="muted">—</span>}</td>
              <td className="num"><b>{n(p.netPaid)}</b></td>
              <td className="num">{Number(p.carryOut) ? <span className="badge amber">{n(p.carryOut)}</span> : <span className="muted">—</span>}</td>
              <td>{p.alreadyRun ? <span className="badge green">Paid</span> : <span className="badge">Not finalised</span>}</td>
              <td>
                <div className="row-actions">
                  {p.alreadyRun ? (
                    <>
                      <Link href={`/payroll/${p.alreadyRun.id}`}>Slip</Link>
                      <BusyButton className="secondary" busy={busy === `run-${p.employee.id}`} onClick={() => cancelRun(p)}>Cancel</BusyButton>
                    </>
                  ) : <BusyButton busy={busy === `run-${p.employee.id}`} onClick={() => run(p)}>Finalise</BusyButton>}
                </div>
              </td>
            </tr>
          ))}
          {previews && !previews.length && (
            <tr><td colSpan={11}><Empty icon="employees" title="No employees yet" text="Add staff with their salary or daily wage first." action={<Link className="btn primary" href="/employees"><Icon name="plus" />Add employees</Link>} /></td></tr>
          )}
        </tbody>
      </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Monthly staff lose salary ÷ 30 per absent or unpaid-leave day (half day = half). Daily staff are paid for days present (half day = half) and paid leave. Advances above what was earned carry to next month.</p>

      <div className="dash-grid" style={{ marginTop: 28 }}>
        <section className="card">
          <div className="card-head">
            <h2>Attendance</h2>
            <div className="actions">
              <input type="date" aria-label="Attendance date" value={attDate} max={today()} onChange={(e) => setAttDate(e.target.value)} style={{ minWidth: 0 }} />
              <BusyButton busy={busy === 'att'} onClick={saveAttendance} disabled={!employees.length}>Save</BusyButton>
            </div>
          </div>
          <p className="card-sub" style={{ margin: '-4px 0 14px' }}>{markedToday ? 'Already marked for this day — saving updates it.' : 'Not marked yet. Everyone starts as present.'}</p>
          <ul className="list">
            {employees.map((e) => {
              const c = monthCounts[e.id] ?? {};
              return (
                <li key={e.id} style={{ flexWrap: 'wrap' }}>
                  <span className="who-line">
                    <b>{e.name}</b>
                    <span>This month: {c.PRESENT ?? 0} present{c.ABSENT ? ` · ${c.ABSENT} absent` : ''}{c.HALF_DAY ? ` · ${c.HALF_DAY} half` : ''}{c.PAID_LEAVE || c.UNPAID_LEAVE ? ` · ${(c.PAID_LEAVE ?? 0) + (c.UNPAID_LEAVE ?? 0)} leave` : ''}</span>
                  </span>
                  <div className="chips" role="radiogroup" aria-label={`${e.name} attendance`}>
                    {STATUSES.map(([v, l, tone]) => {
                      const on = (att[e.id] ?? 'PRESENT') === v;
                      return <button key={v} type="button" role="radio" aria-checked={on} className={`chip${on ? ' on' : ''}`} data-tone={tone} onClick={() => setAtt({ ...att, [e.id]: v })}>{l}</button>;
                    })}
                  </div>
                </li>
              );
            })}
            {!employees.length && <li className="muted">No employees.</li>}
          </ul>
        </section>

        <form className="card side-form" onSubmit={addAdvance}>
          <h2 style={{ margin: 0 }}>Give an advance</h2>
          <label>Employee
            <select required value={adv.employeeId} onChange={(e) => setAdv({ ...adv, employeeId: e.target.value })}>
              <option value="">Select employee…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label>Amount (Rs)<input className="big" type="number" step="any" min="1" required inputMode="decimal" placeholder="0" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} /></label>
          <div className="two">
            <label>Date<input type="date" required value={adv.date} onChange={(e) => setAdv({ ...adv, date: e.target.value })} /></label>
            <label>Note<input value={adv.note} placeholder="Optional" onChange={(e) => setAdv({ ...adv, note: e.target.value })} /></label>
          </div>
          <BusyButton type="submit" busy={busy === 'adv'}>Record advance</BusyButton>
        </form>
      </div>

      <h2>Advances</h2>
      <table>
        <thead><tr><th>Date</th><th>Employee</th><th className="num">Amount</th><th>Note</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {!advances && !error && <SkeletonRows cols={6} rows={3} />}
          {advPage.map((a) => (
            <tr key={a.id} className={a.status === 'CANCELLED' ? 'inactive' : ''}>
              <td>{new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td>{a.employee.name}</td>
              <td className="num"><b>{n(a.amount)}</b></td>
              <td className="muted">{a.note}</td>
              <td>{a.status === 'CANCELLED' ? <span className="badge">Cancelled</span> : a.payrollRunId ? <span className="badge green">Deducted</span> : <span className="badge amber">Waiting for payroll</span>}</td>
              <td>{a.status === 'ACTIVE' && !a.payrollRunId && <BusyButton className="secondary" busy={busy === `a-${a.id}`} onClick={() => cancelAdvance(a)}>Cancel</BusyButton>}</td>
            </tr>
          ))}
          {advances && !advances.length && <tr><td colSpan={6}><Empty icon="wallet" title="No advances" text="Advances given to staff are deducted in the next payroll." /></td></tr>}
        </tbody>
      </table>
      <LoadMore shown={advPage.length} total={advances?.length ?? 0} onMore={advMore} />
    </>
  );
}
