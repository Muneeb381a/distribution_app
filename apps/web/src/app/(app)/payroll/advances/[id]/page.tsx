'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BusyButton, usePrompt, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { advanceState } from '@/lib/advances';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { useSettings } from '@/lib/settings';
import { contactLine, formatDate, money, monthName, rupees } from '@dist/shared';

interface Recovery { id: string; date: string; amount: string; note: string | null; status: string; payrollRunId: string | null; payrollRun: { id: string; month: string } | null }
interface AdvanceSlip {
  id: string; date: string; amount: string; installment: string | null; note: string | null; status: string; createdAt: string;
  recovered: string; remaining: string; createdBy: string | null;
  employee: { id: string; name: string; phone: string | null; type: string };
  recoveries: Recovery[];
}

/** Printable record of one advance: what was given, how it is paid back, and every cut so far. */
export default function AdvanceSlipPage() {
  const { id } = useParams<{ id: string }>();
  const biz = useSettings();
  const toast = useToast();
  const prompt = usePrompt();
  const [a, setA] = useState<AdvanceSlip | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  usePageTitle(a ? `Advance slip · ${a.employee.name}` : null);

  const load = useCallback(() => api<AdvanceSlip>(`/advances/${id}`).then(setA).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try { await fn(); toast.success(done); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  }

  async function repay() {
    if (!a) return;
    const v = await prompt({ title: `Cash paid back by ${a.employee.name}`, body: <p>Rs {rupees(a.remaining)} is left on this advance.</p>, label: 'Amount (Rs)', type: 'number', initial: a.remaining.replace(/\.00$/, ''), confirmLabel: 'Record repayment' });
    if (!v || !(Number(v) > 0)) return;
    act('repay', () => api(`/advances/${a.id}/repay`, { method: 'POST', json: { amount: Number(v) } }), `Rs ${rupees(v)} repayment recorded`);
  }

  async function changeCut() {
    if (!a) return;
    const v = await prompt({ title: 'Monthly cut', body: <p>Taken from each salary until the advance is recovered. Leave empty to take everything left from the next salary.</p>, label: 'Rs per month', type: 'number', initial: a.installment ? String(Number(a.installment)) : '', confirmLabel: 'Save' });
    if (v === null) return;
    act('cut', () => api(`/advances/${a.id}/installment`, { method: 'PUT', json: { installment: v.trim() ? Number(v) : null } }), v.trim() ? `Monthly cut set to Rs ${rupees(v)}` : 'Whole remainder comes off the next salary');
  }

  async function undoRepay(r: Recovery) {
    act(`r-${r.id}`, () => api(`/advances/recoveries/${r.id}/cancel`, { method: 'POST', json: {} }), 'Repayment cancelled');
  }

  const st = a ? advanceState(a) : null;
  const open = a?.status === 'ACTIVE' && Number(a.remaining) > 0;
  const months = a?.installment && open ? Math.ceil(Number(a.remaining) / Number(a.installment)) : 0;

  return (
    <>
      <div className="no-print">
        <Link className="back" href="/payroll"><Icon name="chevronLeft" />Payroll</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {!a && !error && <span className="skeleton" style={{ display: 'block', maxWidth: 600, height: 420, margin: '0 auto' }} />}
      {a && st && (
        <article className="slip card paper">
          <header className="slip-head">
            <div>
              <span className="slip-biz">{biz.businessName}{contactLine(biz) ? ` · ${contactLine(biz)}` : ''}</span>
              <span className="slip-kicker">Salary advance</span>
              <h1>Rs {money(a.amount)}</h1>
              <span className={`badge ${st.tone} no-print`} style={{ marginTop: 6 }}>{st.label}</span>
            </div>
            <div className="actions no-print">
              <Link className="btn secondary" href={`/employees/${a.employee.id}`}><Icon name="khata" />Ledger</Link>
              <button onClick={() => window.print()}><Icon name="print" />Print</button>
            </div>
          </header>
          <dl className="meta slip-meta">
            <div><dt>Employee</dt><dd>{a.employee.name}{a.employee.phone ? ` · ${a.employee.phone}` : ''}</dd></div>
            <div><dt>Given on</dt><dd>{formatDate(a.date)}</dd></div>
            <div><dt>Paid back</dt><dd>{a.installment ? `Rs ${money(a.installment)} cut each month` : 'All from the next salary'}</dd></div>
            {a.note && <div><dt>Reason</dt><dd>{a.note}</dd></div>}
            {a.createdBy && <div><dt>Given by</dt><dd>{a.createdBy}</dd></div>}
          </dl>
          <table className="slip-table">
            <thead><tr><th>Recovery</th><th className="num">Rs</th></tr></thead>
            <tbody>
              <tr><td>Advance given · {formatDate(a.date)}</td><td className="num">{money(a.amount)}</td></tr>
              {a.recoveries.map((r) => (
                <tr key={r.id} className={r.status === 'CANCELLED' ? 'struck' : 'minus'}>
                  <td>
                    {r.payrollRun ? <>Cut from <Link href={`/payroll/${r.payrollRun.id}`}>{monthName(r.payrollRun.month)}</Link> salary</> : (r.note ?? 'Cash repaid')} · {formatDate(r.date)}
                    {r.status === 'CANCELLED' && <span className="muted"> (cancelled)</span>}
                    {!r.payrollRunId && r.status === 'ACTIVE' && (
                      <BusyButton className="link-btn no-print" busy={busy === `r-${r.id}`} onClick={() => undoRepay(r)}>Undo</BusyButton>
                    )}
                  </td>
                  <td className="num">-{money(r.amount)}</td>
                </tr>
              ))}
              {!a.recoveries.length && <tr><td colSpan={2} className="muted">Nothing recovered yet — the first cut comes with the next payroll.</td></tr>}
            </tbody>
          </table>
          <div className="slip-net">
            <span>{a.status === 'CANCELLED' ? 'Cancelled' : 'Still owed'}</span>
            <b>Rs {money(a.status === 'CANCELLED' ? 0 : a.remaining)}</b>
          </div>
          {months > 0 && <p className="muted" style={{ margin: '10px 0 0' }}>About {months} more month{months === 1 ? '' : 's'} at Rs {money(a.installment!)} a month.</p>}
          {open && (
            <div className="actions no-print" style={{ marginTop: 16 }}>
              <BusyButton className="secondary" busy={busy === 'cut'} onClick={changeCut}><Icon name="edit" />Change monthly cut</BusyButton>
              <BusyButton className="secondary" busy={busy === 'repay'} onClick={repay}><Icon name="wallet" />Cash paid back</BusyButton>
            </div>
          )}
          <footer className="slip-sign">
            <span>Received by {a.employee.name}</span>
            <span>Authorised by</span>
          </footer>
        </article>
      )}
    </>
  );
}
