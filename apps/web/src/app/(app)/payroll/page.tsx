'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { BusyButton, Empty, SkeletonRows, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Affix, Choice, Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { LoadMore, usePaged } from '@/components/Table';
import { advanceState, type Advance } from '@/lib/advances';
import { api } from '@/lib/api';
import { ATTENDANCE_STATUSES, formatDate, localDay, monthName, round2, rupees } from '@dist/shared';

interface Option { id: string; name: string }
interface Cut { advanceId: string; date: string; note: string | null; total: string; installment: string | null; remaining: string; planned: string; amount: string }
interface Preview {
  alreadyRun: { id: string; status?: string } | null;
  employee: { id: string; name: string; type: string };
  base: string; commission: string; absenceDeduction: string; gross: string; advances: string; carryIn: string; netPaid: string; carryOut: string;
  cuts: Cut[]; owedAfter: string;
}
interface Attendance { employeeId: string; date: string; status: string }

const STATUSES = ATTENDANCE_STATUSES.map((s) => [s.value, s.label, s.tone] as const);

export default function PayrollPage() {
  const [month, setMonth] = useState(localDay().slice(0, 7));
  const [employees, setEmployees] = useState<Option[]>([]);
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [advances, setAdvances] = useState<Advance[] | null>(null);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [attDate, setAttDate] = useState(localDay());
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

  const [finalising, setFinalising] = useState<Preview | null>(null);

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

  async function cancelAdvance(a: Advance) {
    if (!(await confirm({ title: 'Cancel this advance?', body: <p>Rs {rupees(a.amount)} to {a.employee.name} on {formatDate(a.date)}. Use this only for an advance entered by mistake.</p>, confirmLabel: 'Cancel advance', cancelLabel: 'Keep', danger: true }))) return;
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
  const openAdvances = (advances ?? []).filter((a) => a.status === 'ACTIVE' && Number(a.remaining) > 0);
  const owedTotal = openAdvances.reduce((s, a) => s + Number(a.remaining), 0);
  // Carry columns only matter for months run before instalments existed.
  const showCarry = (previews ?? []).some((p) => Number(p.carryIn) || Number(p.carryOut));
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
        <div className="stat"><span className="label"><span className="icon"><Icon name="payroll" /></span>Pay for {monthName(month)}</span><span className="value"><small>Rs</small>{rupees(totals.pay)}</span><span className="sub">{previews?.length ?? 0} employees</span></div>
        <div className="stat"><span className="label"><span className="icon green"><Icon name="check" /></span>Finalised</span><span className="value">{totals.done} <small>of {previews?.length ?? 0}</small></span><span className="sub">Rs {rupees(totals.paid)} paid</span></div>
        <div className="stat"><span className="label"><span className="icon amber"><Icon name="wallet" /></span>Advance cuts this month</span><span className="value"><small>Rs</small>{rupees(totals.advances)}</span><span className="sub">Rs {rupees(owedTotal)} owed on {openAdvances.length} advance{openAdvances.length === 1 ? '' : 's'}</span></div>
      </div>

      <h2>Salary for {monthName(month)}</h2>
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Employee</th><th className="num">Base</th><th className="num">Commission</th><th className="num">Absence</th><th className="num">Gross</th>
            <th className="num">Advance cut</th>{showCarry && <th className="num">Carried in</th>}<th className="num">Pay</th>{showCarry && <th className="num">Carry to next</th>}<th>Status</th><th><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {!previews && !error && <SkeletonRows cols={showCarry ? 11 : 9} rows={3} />}
          {previews?.map((p) => (
            <tr key={p.employee.id}>
              <td><Link href={`/employees/${p.employee.id}`}><b>{p.employee.name}</b></Link><div className="muted" style={{ fontSize: 12.5 }}>{p.employee.type === 'DAILY' ? 'Daily wage' : 'Monthly salary'}</div></td>
              <td className="num">{rupees(p.base)}</td>
              <td className="num">{Number(p.commission) ? rupees(p.commission) : <span className="muted">—</span>}</td>
              <td className="num">{Number(p.absenceDeduction) ? <span className="amt-debit">-{rupees(p.absenceDeduction)}</span> : <span className="muted">—</span>}</td>
              <td className="num">{rupees(p.gross)}</td>
              <td className="num">
                {Number(p.advances) ? <span className="amt-debit">-{rupees(p.advances)}</span> : <span className="muted">—</span>}
                {!p.alreadyRun && Number(p.owedAfter) > 0 && <div className="muted" style={{ fontSize: 12 }}>{rupees(p.owedAfter)} left after</div>}
              </td>
              {showCarry && <td className="num">{Number(p.carryIn) ? <span className="amt-debit">-{rupees(p.carryIn)}</span> : <span className="muted">—</span>}</td>}
              <td className="num"><b>{rupees(p.netPaid)}</b></td>
              {showCarry && <td className="num">{Number(p.carryOut) ? <span className="badge amber">{rupees(p.carryOut)}</span> : <span className="muted">—</span>}</td>}
              <td>{p.alreadyRun ? <span className="badge green">Paid</span> : <span className="badge">Not finalised</span>}</td>
              <td>
                <div className="row-actions">
                  {p.alreadyRun ? (
                    <>
                      <Link href={`/payroll/${p.alreadyRun.id}`}>Slip</Link>
                      <BusyButton className="secondary" busy={busy === `run-${p.employee.id}`} onClick={() => cancelRun(p)}>Cancel</BusyButton>
                    </>
                  ) : <button type="button" onClick={() => setFinalising(p)}>Finalise</button>}
                </div>
              </td>
            </tr>
          ))}
          {previews && !previews.length && (
            <tr><td colSpan={showCarry ? 11 : 9}><Empty icon="employees" title="No employees yet" text="Add staff with their salary or daily wage first." action={<Link className="btn primary" href="/employees"><Icon name="plus" />Add employees</Link>} /></td></tr>
          )}
        </tbody>
      </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>Monthly staff lose salary ÷ 30 per absent or unpaid-leave day (half day = half). Daily staff are paid for days present (half day = half) and paid leave. Advances are cut by their monthly instalment (or in full), never more than was earned — the rest stays owed for next month.</p>

      <div className="dash-grid" style={{ marginTop: 28 }}>
        <section className="card">
          <div className="card-head">
            <h2>Attendance</h2>
            <div className="actions">
              <input type="date" aria-label="Attendance date" value={attDate} max={localDay()} onChange={(e) => setAttDate(e.target.value)} style={{ minWidth: 0 }} />
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

        <AdvanceForm employees={employees} advances={advances ?? []} onSaved={load} />
      </div>

      <h2>Advances</h2>
      <div className="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>Employee</th><th className="num">Amount</th><th>Recovery</th><th className="num">Left</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {!advances && !error && <SkeletonRows cols={7} rows={3} />}
          {advPage.map((a) => {
            const st = advanceState(a);
            const pct = Number(a.amount) ? Math.min(100, (Number(a.recovered) / Number(a.amount)) * 100) : 0;
            return (
              <tr key={a.id} className={a.status === 'CANCELLED' ? 'inactive' : ''}>
                <td>{formatDate(a.date)}</td>
                <td><Link href={`/employees/${a.employeeId}`}>{a.employee.name}</Link>{a.note && <div className="muted" style={{ fontSize: 12.5 }}>{a.note}</div>}</td>
                <td className="num"><b>{rupees(a.amount)}</b></td>
                <td style={{ minWidth: 170 }}>
                  <div style={{ fontSize: 13 }}>{a.installment ? `Rs ${rupees(a.installment)} / month` : 'All from next salary'}</div>
                  {a.status === 'ACTIVE' && <div className="meter" style={{ marginTop: 6 }} aria-label={`${Math.round(pct)}% recovered`}><span style={{ width: `${pct}%` }} /></div>}
                </td>
                <td className="num">{a.status === 'ACTIVE' && Number(a.remaining) > 0 ? <b>{rupees(a.remaining)}</b> : <span className="muted">—</span>}</td>
                <td><span className={`badge ${st.tone}`}>{st.label}</span></td>
                <td>
                  <div className="row-actions">
                    <Link href={`/payroll/advances/${a.id}`}>Slip</Link>
                    {a.status === 'ACTIVE' && Number(a.recovered) === 0 && <BusyButton className="secondary" busy={busy === `a-${a.id}`} onClick={() => cancelAdvance(a)}>Cancel</BusyButton>}
                  </div>
                </td>
              </tr>
            );
          })}
          {advances && !advances.length && <tr><td colSpan={7}><Empty icon="wallet" title="No advances" text="Advances given to staff are cut from salary — all at once or a fixed amount each month." /></td></tr>}
        </tbody>
      </table>
      </div>
      <LoadMore shown={advPage.length} total={advances?.length ?? 0} onMore={advMore} />

      {finalising && (
        <FinaliseDialog preview={finalising} month={month} onClose={() => setFinalising(null)}
          onDone={async (name) => { setFinalising(null); toast.success(`Payroll saved for ${name}`); await load(); }} />
      )}
    </>
  );
}

/**
 * Confirms a month's pay. Shows each open advance with this month's planned cut, which the owner
 * can lower, raise (up to what is left) or set to 0 to skip; pay can never go below zero.
 */
function FinaliseDialog({ preview: p, month, onClose, onDone }: { preview: Preview; month: string; onClose: () => void; onDone: (name: string) => void }) {
  const toast = useToast();
  const [cuts, setCuts] = useState<Record<string, string>>(() => Object.fromEntries(p.cuts.map((c) => [c.advanceId, String(Number(c.amount))])));
  const [busy, setBusy] = useState(false);
  const available = Math.max(Number(p.gross) - Number(p.carryIn), 0);
  const total = round2(p.cuts.reduce((s, c) => s + (Number(cuts[c.advanceId]) || 0), 0));
  const over = total > available + 0.001;
  const badCut = p.cuts.find((c) => (Number(cuts[c.advanceId]) || 0) > Number(c.remaining) + 0.001);
  const net = round2(Math.max(available - total, 0));
  const changed = p.cuts.some((c) => (Number(cuts[c.advanceId]) || 0) !== Number(c.amount));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/payroll/run', {
        method: 'POST',
        json: { employeeId: p.employee.id, month, deductions: changed ? p.cuts.map((c) => ({ advanceId: c.advanceId, amount: Number(cuts[c.advanceId]) || 0 })) : undefined },
      });
      onDone(p.employee.name);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  const line = (label: string, value: number, cls = '') => <tr className={cls}><td>{label}</td><td className="num">{value < 0 ? `-${rupees(-value)}` : rupees(value)}</td></tr>;

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="fin-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <form onSubmit={submit}>
          <div className="modal-head">
            <span className="modal-icon ok"><Icon name="payroll" /></span>
            <h2 id="fin-title">Pay {p.employee.name} for {monthName(month)}</h2>
          </div>
          <table className="slip-table fin-table">
            <tbody>
              {line(p.employee.type === 'DAILY' ? 'Wages for days worked' : 'Salary', Number(p.base))}
              {Number(p.commission) > 0 && line('Commission', Number(p.commission))}
              {Number(p.absenceDeduction) > 0 && line('Absence deduction', -Number(p.absenceDeduction), 'minus')}
              {line('Earned', Number(p.gross), 'subtotal')}
              {Number(p.carryIn) > 0 && line('Carried from last month', -Number(p.carryIn), 'minus')}
            </tbody>
          </table>

          {p.cuts.length > 0 && (
            <>
              <h3 style={{ margin: '18px 0 2px' }}>Advance cuts</h3>
              <p className="card-sub" style={{ margin: '0 0 10px' }}>Planned from each advance&apos;s monthly instalment. Change an amount, or set 0 to skip this month.</p>
              <div className="fgrid">
                {p.cuts.map((c) => (
                  <Field key={c.advanceId} span={12} label={<>Advance of {formatDate(c.date)}{c.note ? ` · ${c.note}` : ''}</>}
                    hint={`Rs ${rupees(c.remaining)} left of ${rupees(c.total)} · plan ${c.installment ? `Rs ${rupees(c.installment)}/month` : 'all at once'}${Number(c.amount) < Number(c.planned) && !changed ? ' · cut lowered to fit the salary' : ''}`}
                    error={badCut?.advanceId === c.advanceId ? `Only Rs ${rupees(c.remaining)} is left on this advance` : undefined}>
                    <Affix prefix="Rs">
                      <input type="number" min="0" step="any" inputMode="decimal" max={Number(c.remaining)} value={cuts[c.advanceId] ?? ''}
                        onChange={(e) => setCuts({ ...cuts, [c.advanceId]: e.target.value })} />
                    </Affix>
                  </Field>
                ))}
              </div>
            </>
          )}

          <div className="slip-net" style={{ marginTop: 16 }}>
            <span>Pay in cash</span>
            <b>Rs {rupees(net)}</b>
          </div>
          {over && <p className="error" style={{ marginTop: 10 }}><Icon name="alert" /> Cuts are Rs {rupees(total - available)} more than the salary. Lower a cut — pay cannot go below zero.</p>}
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>The salary (Rs {rupees(p.gross)}) is posted as an expense. Advances were already cash out, so they are not counted twice.</p>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <BusyButton type="submit" busy={busy} disabled={over || !!badCut}><Icon name="check" />Finalise &amp; pay Rs {rupees(net)}</BusyButton>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Give an advance: amount, then how it comes back — all from the next salary or a fixed cut each month. */
function AdvanceForm({ employees, advances, onSaved }: { employees: Option[]; advances: Advance[]; onSaved: () => Promise<void> }) {
  const router = useRouter();
  const toast = useToast();
  const blank = { employeeId: '', amount: '', plan: 'FULL' as 'FULL' | 'MONTHLY', installment: '', date: localDay(), note: '' };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(0);
  const owed = advances.filter((a) => a.employeeId === f.employeeId && a.status === 'ACTIVE').reduce((s, a) => s + Number(a.remaining), 0);
  const amount = Number(f.amount) || 0;
  const inst = Number(f.installment) || 0;
  const months = f.plan === 'MONTHLY' && inst > 0 && amount > 0 ? Math.ceil(amount / inst) : 0;
  const instTooBig = f.plan === 'MONTHLY' && inst > amount && amount > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const row = await api<{ id: string }>('/advances', {
        method: 'POST',
        json: { employeeId: f.employeeId, amount, installment: f.plan === 'MONTHLY' ? inst : undefined, date: f.date, note: f.note || undefined },
      });
      toast.success(`Advance of Rs ${rupees(amount)} recorded for ${employees.find((x) => x.id === f.employeeId)?.name ?? ''}`);
      setF({ ...blank, date: f.date });
      setFresh((n) => n + 1);
      await onSaved();
      router.push(`/payroll/advances/${row.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard key={fresh} title="Give an advance" description="Cash paid ahead of salary. It is cut from salary later." onSubmit={submit}
      actions={<FormActions note="A slip opens to print and sign."><BusyButton type="submit" busy={busy} disabled={instTooBig}><Icon name="print" />Give advance</BusyButton></FormActions>}>
      <FormSection>
        <Field label="Employee" required span={12} hint={f.employeeId ? (owed ? <>Already owes <b>Rs {rupees(owed)}</b> from earlier advances</> : 'Owes nothing at the moment') : undefined}>
          <select required value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
            <option value="">Select employee…</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <Field label="Amount" required span={6}>
          <Affix prefix="Rs"><input className="big" type="number" step="any" min="1" required inputMode="decimal" placeholder="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Affix>
        </Field>
        <Field label="Date" required span={6}><input type="date" required max={localDay()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="How it is paid back" span={12}>
          <Choice name="adv-plan" value={f.plan} onChange={(v) => setF({ ...f, plan: v })} columns={2} options={[
            { value: 'FULL', label: 'Next salary', description: 'Cut all at once', icon: 'payroll' },
            { value: 'MONTHLY', label: 'Monthly cut', description: 'A fixed amount each month', icon: 'history' },
          ]} />
        </Field>
        {f.plan === 'MONTHLY' && (
          <Field label="Cut each month" required span={12}
            error={instTooBig ? 'The monthly cut cannot be more than the advance' : undefined}
            hint={months ? `About ${months} month${months === 1 ? '' : 's'} to recover` : 'Never more than the salary earned; the rest waits for next month'}>
            <Affix prefix="Rs" suffix="/ month"><input type="number" step="any" min="1" required inputMode="decimal" value={f.installment} onChange={(e) => setF({ ...f, installment: e.target.value })} /></Affix>
          </Field>
        )}
        <Field label="Reason" optional span={12}><input value={f.note} maxLength={200} placeholder="Medical, wedding, rent…" onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      </FormSection>
    </FormCard>
  );
}
