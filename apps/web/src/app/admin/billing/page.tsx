'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Spark } from '@/components/AdminBits';
import { Empty, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { PaymentDrawer, type PayTarget } from '@/components/PaymentDrawer';
import { StatTiles } from '@/components/StatTiles';
import { downloadCsv } from '@/components/Table';
import { methodLabel, platformApi, renewalMessage, rs, whatsapp, type Payment, type Tenant } from '@/lib/platform';

interface DueRow { id: string; name: string; code: string; phone: string | null; contactName: string | null; expiresAt: string | null; monthlyFee: string | null; daysLeft: number | null }
interface Summary {
  mrr: string; collectedThisMonth: string; collectedLastMonth: string; payingBusinesses: number; noFeeSet: number;
  months: { month: string; amount: string }[]; overdue: DueRow[]; dueSoon: DueRow[];
}

const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' });

/** Money: what comes in each month, who has to renew, and every payment received. */
export default function BillingPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [sum, setSum] = useState<Summary | null>(null);
  const [pay, setPay] = useState<{ rows: Payment[]; total: string } | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [target, setTarget] = useState<PayTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    platformApi<Summary>('/billing/summary').then((r) => { setSum(r); setError(''); }).catch((e) => setError(e.message));
    platformApi<{ rows: Payment[]; total: string }>('/payments').then(setPay).catch(() => {});
    platformApi<Tenant[]>('/tenants').then(setTenants).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const payFor = (r: DueRow | Tenant) => setTarget({ id: r.id, name: r.name, monthlyFee: r.monthlyFee, expiresAt: r.expiresAt });
  const latestId = (tenantId: string) => pay?.rows.filter((p) => p.tenantId === tenantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id;

  async function undo(p: Payment) {
    if (!(await confirm({ title: 'Undo this payment?', body: <p>{rs(p.amount)} from {p.tenantName} is removed and their end date goes back to what it was.</p>, confirmLabel: 'Undo payment', danger: true }))) return;
    try { await platformApi(`/payments/${p.id}`, { method: 'DELETE' }); toast.success('Payment removed'); load(); } catch (e) { toast.error((e as Error).message); }
  }

  const growth = sum ? Number(sum.collectedThisMonth) - Number(sum.collectedLastMonth) : 0;
  const atRisk = sum?.overdue.reduce((s, r) => s + Number(r.monthlyFee ?? 0), 0) ?? 0;

  const dueList = (title: string, rows: DueRow[] | undefined, tone: 'red' | 'amber') => (
    <section className="card">
      <div className="card-head"><h3>{title}</h3>{rows && rows.length > 0 && <span className="count-pill">{rows.length}</span>}</div>
      {rows && !rows.length && <p className="muted">Nobody.</p>}
      <ul className="due-list">
        {rows?.map((r) => (
          <li key={r.id}>
            <span className={`attn-dot ${tone}`} aria-hidden="true" />
            <Link href={`/admin/tenants/${r.id}`} className="attn-main"><b>{r.name}</b><span>{(r.daysLeft ?? 0) < 0 ? `Ended ${Math.abs(r.daysLeft ?? 0)} day${Math.abs(r.daysLeft ?? 0) === 1 ? '' : 's'} ago` : `Ends in ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'}`}{r.monthlyFee ? ` · ${rs(r.monthlyFee)} / month` : ''}</span></Link>
            {r.phone && <a className="attn-call wa" href={whatsapp(r.phone, renewalMessage(r))} target="_blank" rel="noreferrer" title="Remind on WhatsApp" aria-label={`Remind ${r.name} on WhatsApp`}><Icon name="message" /></a>}
            <button type="button" className="secondary" onClick={() => payFor(r)}>Record payment</button>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div><h1>Billing</h1><p>What comes in, who has to renew, and every payment received.</p></div>
        <button className="btn-icon" onClick={() => setPicking(true)}><Icon name="plus" />Record payment</button>
      </div>
      {error && <p className="error">{error}</p>}

      <StatTiles items={[
        { label: 'Monthly income', value: sum ? rs(sum.mrr) : '—', sub: sum ? `${sum.payingBusinesses} paying business${sum.payingBusinesses === 1 ? '' : 'es'}${sum.noFeeSet ? ` · ${sum.noFeeSet} without a fee` : ''}` : undefined, icon: 'trend', tone: 'green' },
        { label: 'Received this month', value: sum ? rs(sum.collectedThisMonth) : '—', sub: sum ? `${growth >= 0 ? '+' : '−'}${rs(Math.abs(growth))} vs last month` : undefined, icon: 'wallet' },
        { label: 'Have run out', value: sum?.overdue.length ?? '—', sub: atRisk ? `${rs(atRisk)} a month at stake` : 'access ended, not renewed', icon: 'alert', tone: sum?.overdue.length ? 'red' : 'green' },
        { label: 'Ending soon', value: sum?.dueSoon.length ?? '—', sub: 'within 10 days', icon: 'history', tone: sum?.dueSoon.length ? 'amber' : 'green' },
      ]} />

      <div className="admin-grid">
        <section className="card">
          <div className="card-head"><h3>Received, last 6 months</h3>{pay && <span className="muted">{pay.rows.length} payments in total</span>}</div>
          <Spark label="Money received per month" data={(sum?.months ?? []).map((m) => ({ key: m.month, value: Number(m.amount), tick: monthName(m.month), note: `${monthName(m.month)}: ${rs(m.amount)}` }))} />
        </section>
        {dueList('Renewal due soon', sum?.dueSoon, 'amber')}
      </div>
      {dueList('Access has ended', sum?.overdue, 'red')}

      <div className="section-head">
        <h2>All payments</h2>
        <button className="secondary btn-icon" disabled={!pay?.rows.length} onClick={() => pay && downloadCsv('payments.csv', ['Date', 'Business', 'Code', 'Amount', 'Method', 'Months', 'Recorded by', 'Note'], pay.rows.map((p) => [p.paidOn.slice(0, 10), p.tenantName, p.tenantCode, p.amount, methodLabel(p.method), p.months, p.createdByName, p.note]))}><Icon name="download" />Export CSV</button>
      </div>
      <table className="sticky-head">
        <thead><tr><th>Received</th><th>Business</th><th className="num">Amount</th><th>Method</th><th>Covers</th><th>Note</th><th>By</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {pay?.rows.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{new Date(p.paidOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td><Link href={`/admin/tenants/${p.tenantId}`}><b>{p.tenantName}</b></Link></td>
              <td className="num"><b>{rs(p.amount)}</b></td>
              <td><span className="badge blue">{methodLabel(p.method)}</span></td>
              <td className="muted">{p.months} month{p.months === 1 ? '' : 's'}</td>
              <td className="muted">{p.note}</td>
              <td className="muted">{p.createdByName}</td>
              <td>{latestId(p.tenantId) === p.id && <button type="button" className="secondary icon-only danger-hover" title="Undo this payment" aria-label="Undo this payment" onClick={() => void undo(p)}><Icon name="ban" /></button>}</td>
            </tr>
          ))}
          {pay && !pay.rows.length && <tr><td colSpan={8}><Empty icon="wallet" title="No payments yet" text="Record one when a business pays; its end date moves forward by itself." /></td></tr>}
        </tbody>
        {pay && pay.rows.length > 0 && <tfoot><tr><td colSpan={2}>Total</td><td className="num"><b>{rs(pay.total)}</b></td><td colSpan={5} /></tr></tfoot>}
      </table>

      {picking && (
        <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setPicking(false); }}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="pick-title" onKeyDown={(e) => { if (e.key === 'Escape') setPicking(false); }}>
            <header className="drawer-head">
              <span className="drawer-icon"><Icon name="customers" /></span>
              <div><h2 id="pick-title">Who paid?</h2><p>Choose the business</p></div>
              <button type="button" className="drawer-x" onClick={() => setPicking(false)} aria-label="Close"><Icon name="x" /></button>
            </header>
            <div className="drawer-body">
              <ul className="pick-list">
                {tenants.filter((t) => !t.isMain).map((t) => (
                  <li key={t.id}><button type="button" onClick={() => { setPicking(false); payFor(t); }}><span className="tenant-badge">{t.name.slice(0, 1).toUpperCase()}</span><span><b>{t.name}</b><small>{t.code}{t.monthlyFee ? ` · ${rs(t.monthlyFee)} / month` : ''}</small></span><Icon name="chevronRight" /></button></li>
                ))}
              </ul>
              {!tenants.some((t) => !t.isMain) && <p className="muted">There are no businesses yet.</p>}
            </div>
          </aside>
        </div>
      )}
      {target && <PaymentDrawer tenant={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} />}
    </>
  );
}
