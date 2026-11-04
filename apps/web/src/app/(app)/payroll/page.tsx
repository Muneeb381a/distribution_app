'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';

interface Option { id: string; name: string }
interface Preview {
  alreadyRun: { id: string } | null;
  employee: { id: string; name: string; type: string };
  base: string; commission: string; absenceDeduction: string; gross: string; advances: string; carryIn: string; netPaid: string; carryOut: string;
}
interface Advance { id: string; date: string; amount: string; note: string | null; payrollRunId: string | null; status: string; employee: { name: string } }

const STATUSES = [
  ['PRESENT', 'Present'], ['ABSENT', 'Absent'], ['HALF_DAY', 'Half day'], ['PAID_LEAVE', 'Paid leave'], ['UNPAID_LEAVE', 'Unpaid leave'],
];
const today = () => new Date().toISOString().slice(0, 10);
const n = (v: string) => Number(v).toLocaleString();

export default function PayrollPage() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const [employees, setEmployees] = useState<Option[]>([]);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [adv, setAdv] = useState({ employeeId: '', amount: '', date: today(), note: '' });
  const [attDate, setAttDate] = useState(today());
  const [att, setAtt] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try {
      const emps = await api<Option[]>('/employees/options');
      setEmployees(emps);
      setPreviews(await Promise.all(emps.map((e) => api<Preview>(`/payroll/preview?employeeId=${e.id}&month=${month}`))));
      setAdvances(await api<Advance[]>('/advances'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [month]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const run = (p: Preview) => {
    if (!confirm(`Finalise ${p.employee.name} for ${month}?\nPay ${n(p.netPaid)}${Number(p.carryOut) ? `, carry ${n(p.carryOut)} to next month` : ''}.`)) return;
    return act(() => api('/payroll/run', { method: 'POST', json: { employeeId: p.employee.id, month } }), `Payroll saved for ${p.employee.name}`);
  };

  function addAdvance(e: FormEvent) {
    e.preventDefault();
    return act(async () => {
      await api('/advances', { method: 'POST', json: { employeeId: adv.employeeId, amount: Number(adv.amount), date: adv.date, note: adv.note || undefined } });
      setAdv({ ...adv, amount: '', note: '' });
    }, 'Advance recorded');
  }

  const saveAttendance = () =>
    act(
      () => api('/attendance', { method: 'PUT', json: { date: attDate, entries: employees.map((e) => ({ employeeId: e.id, status: att[e.id] ?? 'PRESENT' })) } }),
      `Attendance saved for ${attDate}`,
    );

  return (
    <>
      <div className="page-head"><div><h1>Payroll</h1><p>Monthly salaries, advances and attendance</p></div></div>
      {error && <p className="error">{error}</p>}
      {msg && <p className="ok">{msg}</p>}
      <div className="toolbar">
        <label>Month <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      </div>
      <table>
        <thead><tr><th>Employee</th><th className="num">Base</th><th className="num">Commission</th><th className="num">Absence</th><th className="num">Gross</th><th className="num">Advances</th><th className="num">Carried in</th><th className="num">Pay</th><th className="num">Carry to next</th><th /></tr></thead>
        <tbody>
          {previews.map((p) => (
            <tr key={p.employee.id}>
              <td>{p.employee.name}<span className="muted"> ({p.employee.type === 'DAILY' ? 'daily' : 'monthly'})</span></td>
              <td className="num">{n(p.base)}</td><td className="num">{n(p.commission)}</td><td className="num">{Number(p.absenceDeduction) ? `-${n(p.absenceDeduction)}` : '—'}</td>
              <td className="num">{n(p.gross)}</td><td className="num">{Number(p.advances) ? `-${n(p.advances)}` : '—'}</td><td className="num">{Number(p.carryIn) ? `-${n(p.carryIn)}` : '—'}</td>
              <td className="num"><strong>{n(p.netPaid)}</strong></td><td className={`num ${Number(p.carryOut) ? 'error' : 'muted'}`}>{Number(p.carryOut) ? n(p.carryOut) : '—'}</td>
              <td>{p.alreadyRun ? <Link href={`/payroll/${p.alreadyRun.id}`}>Slip</Link> : <button onClick={() => run(p)}>Finalise</button>}</td>
            </tr>
          ))}
          {!previews.length && <tr><td colSpan={10} className="empty">No employees yet.</td></tr>}
        </tbody>
      </table>
      <p className="muted">Monthly staff lose salary ÷ 30 per absent or unpaid-leave day (half day = half). Daily staff are paid for days present (half day = half) and paid leave. Advances above what was earned carry to next month.</p>

      <h2>Attendance</h2>
      <div className="card">
        <div className="toolbar"><label>Date <input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} /></label><button onClick={saveAttendance}>Save attendance</button></div>
        <div className="form">
          {employees.map((e) => (
            <label key={e.id}>{e.name}
              <select value={att[e.id] ?? 'PRESENT'} onChange={(ev) => setAtt({ ...att, [e.id]: ev.target.value })}>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <h2>Advances</h2>
      <form className="card form" onSubmit={addAdvance}>
        <p className="form-title">Give an advance</p>
        <label>Employee
          <select required value={adv.employeeId} onChange={(e) => setAdv({ ...adv, employeeId: e.target.value })}>
            <option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
        <label>Amount<input type="number" step="any" min="0" required value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} /></label>
        <label>Date<input type="date" required value={adv.date} onChange={(e) => setAdv({ ...adv, date: e.target.value })} /></label>
        <label>Note<input value={adv.note} onChange={(e) => setAdv({ ...adv, note: e.target.value })} /></label>
        <button>Add advance</button>
      </form>
      <table>
        <thead><tr><th>Date</th><th>Employee</th><th>Amount</th><th>Status</th><th /></tr></thead>
        <tbody>
          {advances.slice(0, 30).map((a) => (
            <tr key={a.id} style={a.status === 'CANCELLED' ? { opacity: 0.5 } : undefined}>
              <td>{a.date.slice(0, 10)}</td><td>{a.employee.name}</td><td>{n(a.amount)}</td>
              <td>{a.status === 'CANCELLED' ? 'Cancelled' : a.payrollRunId ? 'Deducted' : 'Waiting for payroll'}</td>
              <td>{a.status === 'ACTIVE' && !a.payrollRunId && <button className="secondary" onClick={() => act(() => api(`/advances/${a.id}/cancel`, { method: 'POST', json: {} }), 'Advance cancelled')}>Cancel</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
