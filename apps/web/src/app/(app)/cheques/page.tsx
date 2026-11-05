'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BusyButton, Empty, SkeletonRows, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { addDays, formatDate, localDay, money, rupees } from '@dist/shared';

type Status = 'PENDING' | 'CLEARED' | 'BOUNCED';
interface Cheque {
  id: string; receiptNo: string; amount: string; date: string; chequeNo: string; chequeBank: string | null; chequeDate: string | null;
  chequeStatus: Status; chequeSettledAt: string | null; customer: { id: string; name: string; shopName: string | null; phone: string | null };
}

const TABS: [Status, string][] = [['PENDING', 'Pending'], ['CLEARED', 'Cleared'], ['BOUNCED', 'Bounced']];

/** When a pending cheque can be deposited, relative to today. */
function due(c: Cheque, today: string) {
  const d = c.chequeDate?.slice(0, 10) ?? c.date.slice(0, 10);
  if (d < today) return { text: 'Deposit now', tone: 'red' };
  if (d === today) return { text: 'Today', tone: 'amber' };
  const days = Math.round((new Date(`${d}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
  return { text: days === 1 ? 'Tomorrow' : `In ${days} days`, tone: days <= 3 ? 'amber' : '' };
}

/**
 * Customer cheques. The khata is credited when a cheque is received; here it is marked cleared
 * once the bank pays, or bounced, which puts the amount back on the customer's khata.
 */
export default function ChequesPage() {
  usePageTitle('Cheques');
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [tab, setTab] = useState<Status>('PENDING');
  const [rows, setRows] = useState<Cheque[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const today = localDay();

  const load = useCallback(() => api<Cheque[]>(`/cheques?status=${tab}`).then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message)), [tab]);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const list = tab === 'PENDING' ? rows ?? [] : [];
    const week = localDay(addDays(new Date(), 7));
    const ready = list.filter((c) => (c.chequeDate?.slice(0, 10) ?? today) <= today);
    const soon = list.filter((c) => { const d = c.chequeDate?.slice(0, 10) ?? today; return d > today && d <= week; });
    const sum = (l: Cheque[]) => l.reduce((s, c) => s + Number(c.amount), 0);
    return { total: sum(list), count: list.length, ready: sum(ready), readyCount: ready.length, soon: sum(soon), soonCount: soon.length };
  }, [rows, tab, today]);

  async function clear(c: Cheque) {
    if (!(await confirm({ title: `Cheque ${c.chequeNo} cleared?`, body: <p>Rs {money(c.amount)} from {c.customer.name}. The khata already counts it; this just marks it as paid by the bank.</p>, confirmLabel: 'Mark cleared' }))) return;
    setBusy(c.id);
    try { await api(`/cheques/${c.id}/clear`, { method: 'POST', json: {} }); toast.success(`Cheque ${c.chequeNo} cleared`); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  }

  async function bounce(c: Cheque) {
    const note = await prompt({
      title: `Cheque ${c.chequeNo} bounced?`,
      body: <p>Rs {money(c.amount)} goes back on <b>{c.customer.name}</b>&apos;s khata and receipt {c.receiptNo} is cancelled.</p>,
      label: 'Reason (optional)', initial: '', confirmLabel: 'Mark bounced', cancelLabel: 'Keep', danger: true,
    });
    if (note === null) return;
    setBusy(c.id);
    try { await api(`/cheques/${c.id}/bounce`, { method: 'POST', json: { note } }); toast.success(`Rs ${money(c.amount)} added back to ${c.customer.name}'s khata`); await load(); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(''); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Cheques</h1><p>Cheques taken from customers. Mark each one cleared when the bank pays, or bounced.</p></div>
      </div>
      {error && <p className="error">{error}</p>}

      {tab === 'PENDING' && (
        <div className="stats">
          <div className="stat"><span className="label"><span className="icon amber"><Icon name="wallet" /></span>Pending</span><span className="value"><small>Rs</small>{rupees(stats.total)}</span><span className="sub">{stats.count} cheque{stats.count === 1 ? '' : 's'}</span></div>
          <div className="stat"><span className="label"><span className={`icon ${stats.readyCount ? 'red' : 'green'}`}><Icon name="alert" /></span>Can deposit now</span><span className="value"><small>Rs</small>{rupees(stats.ready)}</span><span className="sub">{stats.readyCount ? `${stats.readyCount} dated today or earlier` : 'Nothing due yet'}</span></div>
          <div className="stat"><span className="label"><span className="icon"><Icon name="history" /></span>Next 7 days</span><span className="value"><small>Rs</small>{rupees(stats.soon)}</span><span className="sub">{stats.soonCount} post-dated</span></div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map(([v, l]) => <button key={v} role="tab" aria-selected={tab === v} onClick={() => { if (v !== tab) { setRows(null); setTab(v); } }}>{l}</button>)}
      </div>

      <div className="table-wrap">
        <table className="stack-sm">
          <thead>
            <tr>
              <th>{tab === 'PENDING' ? 'Deposit from' : tab === 'CLEARED' ? 'Cleared' : 'Bounced'}</th><th>Customer</th><th>Cheque</th><th className="num">Amount</th><th>Receipt</th>
              {tab === 'PENDING' && <th><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {!rows && !error && <SkeletonRows cols={tab === 'PENDING' ? 6 : 5} />}
            {rows?.map((c) => {
              const d = due(c, today);
              return (
                <tr key={c.id}>
                  <td>
                    {tab === 'PENDING'
                      ? <><b>{formatDate(c.chequeDate ?? c.date)}</b><div><span className={`badge ${d.tone}`}>{d.text}</span></div></>
                      : formatDate(c.chequeSettledAt ?? c.date)}
                  </td>
                  <td><Link href={`/khata/${c.customer.id}`}><b>{c.customer.name}</b></Link>{c.customer.shopName && <div className="muted" style={{ fontSize: 12.5 }}>{c.customer.shopName}</div>}</td>
                  <td><b>{c.chequeNo}</b>{c.chequeBank && <div className="muted" style={{ fontSize: 12.5 }}>{c.chequeBank}</div>}</td>
                  <td className="num stack-amount"><b>Rs {money(c.amount)}</b></td>
                  <td><Link href={`/receipts/${c.id}`}>{c.receiptNo}</Link><div className="muted" style={{ fontSize: 12.5 }}>taken {formatDate(c.date, 'short')}</div></td>
                  {tab === 'PENDING' && (
                    <td className="stack-actions">
                      <div className="row-actions">
                        <BusyButton className="secondary" busy={busy === c.id} onClick={() => clear(c)}><Icon name="check" />Cleared</BusyButton>
                        {can(user, 'SALE_CANCEL') && <button type="button" className="danger-ghost" disabled={busy === c.id} onClick={() => bounce(c)}>Bounced</button>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows && !rows.length && (
              <tr><td colSpan={tab === 'PENDING' ? 6 : 5}>
                <Empty icon="wallet" title={tab === 'PENDING' ? 'No pending cheques' : tab === 'CLEARED' ? 'No cleared cheques yet' : 'No bounced cheques'}
                  text={tab === 'PENDING' ? 'Take a cheque from a customer’s khata page: choose Cheque as the method.' : 'Cheques show here once marked.'} />
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
