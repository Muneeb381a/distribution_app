'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Empty } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { localDay, methodLabel, monthStart, money, rupees } from '@dist/shared';

export interface Person {
  key: string; name: string; username: string | null; avatar: string | null; roleName: string | null; employeeId: string | null; commissionPercent: string | null;
  bills: number; cancelled: number; sales: string; cashWithBills: string; udhaar: string; receipts: string; receiptCount: number; byMethod: Record<string, string>;
  lastAt: string | null; collected: string; commission: string;
}
interface Team {
  from: string; to: string;
  totals: { bills: number; sales: string; collected: string; cashWithBills: string; receipts: string; udhaar: string };
  people: Person[];
}
interface Activity {
  bills: { id: string; billNo: string; at: string; saleType: string; status: string; customer: string | null; net: string; paidNow: string }[];
  receipts: { id: string; receiptNo: string; at: string; customer: string; amount: string; method: string }[];
}

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month'], ['custom', 'Pick dates']];
const n = (v: string | number) => Number(v);
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function rangeFor(p: Preset, custom: { from: string; to: string }) {
  const t = new Date();
  const day = (offset: number) => localDay(new Date(t.getFullYear(), t.getMonth(), t.getDate() + offset));
  if (p === 'today') return { from: day(0), to: day(0) };
  if (p === 'yesterday') return { from: day(-1), to: day(-1) };
  if (p === 'week') return { from: day(-6), to: day(0) };
  if (p === 'month') return { from: localDay(monthStart()), to: day(0) };
  return custom;
}

/**
 * Team activity: for the owner, who made which sales, how much money each person took (with bills and from
 * old khata), what they gave on udhaar, and their commission. Click a person to see every bill and receipt.
 */
export default function TeamPage() {
  usePageTitle('Team activity');
  const user = useUser();
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState({ from: localDay(), to: localDay() });
  const [data, setData] = useState<Team | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Person | null>(null);
  const range = useMemo(() => rangeFor(preset, custom), [preset, custom]);

  const load = useCallback(() => {
    setData(null);
    api<Team>(`/reports/team?from=${range.from}&to=${range.to}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [range.from, range.to]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!user) return null;
  if (!can(user, 'REPORT_VIEW')) return <p className="error">You need the report permission to see team activity.</p>;

  const top = Math.max(...(data?.people ?? []).map((p) => n(p.sales)), 1);
  const single = range.from === range.to;

  return (
    <>
      <div className="page-head">
        <div><h1>Team activity</h1><p>Who sold what, and how much money each person took.</p></div>
      </div>

      <div className="list-head">
        <div className="chips" role="group" aria-label="Period">
          {PRESETS.map(([v, l]) => <button key={v} type="button" className={`chip${preset === v ? ' on' : ''}`} aria-pressed={preset === v} onClick={() => setPreset(v)}>{l}</button>)}
        </div>
        {preset === 'custom' && (
          <div className="date-range">
            <input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="muted">to</span>
            <input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        <span className="count muted">{single ? dayLabel(range.from) : `${dayLabel(range.from)} to ${dayLabel(range.to)}`}</span>
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}</div>}

      {data && (
        <>
          <StatTiles items={[
            { label: 'Sales made', value: <><small>Rs</small>{rupees(data.totals.sales)}</>, sub: `${data.totals.bills} bill${data.totals.bills === 1 ? '' : 's'} by ${data.people.length} ${data.people.length === 1 ? 'person' : 'people'}`, icon: 'sales' },
            { label: 'Money collected', value: <><small>Rs</small>{rupees(data.totals.collected)}</>, sub: `Rs ${rupees(data.totals.cashWithBills)} with bills · Rs ${rupees(data.totals.receipts)} from khata`, icon: 'wallet', tone: 'green' },
            { label: 'Udhaar given', value: <><small>Rs</small>{rupees(data.totals.udhaar)}</>, sub: 'unpaid part of the bills', icon: 'khata', tone: n(data.totals.udhaar) ? 'amber' : 'green' },
            { label: 'Collected vs sold', value: `${n(data.totals.sales) > 0 ? Math.round((n(data.totals.cashWithBills) / n(data.totals.sales)) * 100) : 0}%`, sub: 'of sales paid at the time of the bill', icon: 'trend' },
          ]} />

          {data.people.length === 0 ? (
            <Empty icon="employees" title="No activity in this period" text="Bills and payments taken by your team show here." />
          ) : (
            <div className="team-grid">
              {data.people.map((p, i) => {
                const pct = Math.round((n(p.sales) / top) * 100);
                const collected = n(p.collected);
                const methods = Object.entries(p.byMethod).filter(([, v]) => n(v) > 0);
                return (
                  <article key={p.key} className="card team-card" style={{ ['--i' as string]: i }}>
                    <header>
                      <Avatar user={{ username: p.name, displayName: p.name, avatar: p.avatar }} size={48} />
                      <span className="team-who">
                        <b>{p.name}</b>
                        <span>{[p.roleName, p.username && p.username !== p.name ? `@${p.username}` : null].filter(Boolean).join(' · ') || 'Team member'}</span>
                      </span>
                      {i === 0 && n(p.sales) > 0 && data.people.length > 1 && <span className="badge amber team-top">Top seller</span>}
                    </header>

                    <div className="team-sales">
                      <span>Sales</span>
                      <b><small>Rs</small>{rupees(p.sales)}</b>
                      <span className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
                    </div>

                    <dl className="team-stats">
                      <div><dt>Bills</dt><dd>{p.bills}{p.cancelled > 0 && <small> · {p.cancelled} cancelled</small>}</dd></div>
                      <div><dt>Money taken</dt><dd className="ok">Rs {rupees(collected)}</dd></div>
                      <div><dt>Udhaar given</dt><dd className={n(p.udhaar) ? 'warnc' : ''}>Rs {rupees(p.udhaar)}</dd></div>
                      {p.employeeId && <div><dt>Commission{p.commissionPercent ? ` ${n(p.commissionPercent)}%` : ''}</dt><dd>Rs {rupees(p.commission)}</dd></div>}
                    </dl>

                    <div className="team-split" aria-label="Where the money came from">
                      <span className="method-bar" aria-hidden="true">
                        <span style={{ flex: Math.max(n(p.cashWithBills), 0.0001), background: 'var(--series-3)' }} />
                        <span style={{ flex: Math.max(n(p.receipts), 0.0001), background: 'var(--series-1)' }} />
                      </span>
                      <span className="team-legend">
                        <span><i style={{ background: 'var(--series-3)' }} />With bills Rs {rupees(p.cashWithBills)}</span>
                        <span><i style={{ background: 'var(--series-1)' }} />Old khata Rs {rupees(p.receipts)}{p.receiptCount ? ` (${p.receiptCount})` : ''}</span>
                      </span>
                      {methods.length > 0 && <span className="team-methods">{methods.map(([m, v]) => `${methodLabel(m)} ${rupees(v)}`).join(' · ')}</span>}
                    </div>

                    <footer>
                      <span className="muted">{p.lastAt ? `Last activity ${single ? clock(p.lastAt) : `${dayLabel(p.lastAt)}, ${clock(p.lastAt)}`}` : 'No activity'}</span>
                      <button type="button" className="secondary" onClick={() => setOpen(p)}>See everything<Icon name="chevronRight" /></button>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
          <p className="muted team-note">A bill counts for its salesman, or for whoever entered it when no salesman is chosen. Khata payments count for the person who recorded them. Cancelled bills are left out of the totals.</p>
        </>
      )}

      {open && <PersonDrawer person={open} range={range} onClose={() => setOpen(null)} />}
    </>
  );
}

function PersonDrawer({ person, range, onClose }: { person: Person; range: { from: string; to: string }; onClose: () => void }) {
  const [act, setAct] = useState<Activity | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Activity>(`/reports/team/activity?key=${encodeURIComponent(person.key)}&from=${range.from}&to=${range.to}`).then(setAct).catch((e) => setError(e.message));
  }, [person.key, range.from, range.to]);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const items = useMemo(() => {
    if (!act) return [];
    return [
      ...act.bills.map((b) => ({ kind: 'bill' as const, at: b.at, id: b.id, b })),
      ...act.receipts.map((r) => ({ kind: 'receipt' as const, at: r.at, id: r.id, r })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [act]);

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="team-drawer-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <header className="drawer-head">
          <Avatar user={{ username: person.name, displayName: person.name, avatar: person.avatar }} size={46} />
          <div>
            <h2 id="team-drawer-title">{person.name}</h2>
            <p>{dayLabel(range.from)}{range.from !== range.to ? ` to ${dayLabel(range.to)}` : ''} · {person.bills} bills · Rs {rupees(person.sales)} sold · Rs {rupees(person.collected)} taken</p>
          </div>
          <button type="button" className="drawer-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="drawer-body">
          {error && <p className="error">{error}</p>}
          {!act && !error && <span className="skeleton" style={{ display: 'block', height: 240 }} />}
          {act && !items.length && <Empty icon="file" title="Nothing in this period" />}
          <ol className="team-timeline">
            {items.map((it) => (
              <li key={`${it.kind}${it.id}`} className={`tl-${it.kind}`}>
                <span className="tl-icon"><Icon name={it.kind === 'bill' ? 'sales' : 'wallet'} /></span>
                <span className="tl-main">
                  {it.kind === 'bill' ? (
                    <>
                      <b><Link href={`/sales/${it.b.id}`} onClick={onClose}>{it.b.billNo}</Link> · {it.b.customer ?? 'Cash sale'}</b>
                      <span>{clock(it.at)} · {dayLabel(it.at)} · {it.b.saleType === 'DELIVERY' ? 'Delivery' : 'Counter'}{it.b.status !== 'ACTIVE' && <span className="badge red">Cancelled</span>}</span>
                    </>
                  ) : (
                    <>
                      <b><Link href={`/receipts/${it.r.id}`} onClick={onClose}>{it.r.receiptNo}</Link> · {it.r.customer}</b>
                      <span>{clock(it.at)} · {dayLabel(it.at)} · khata payment, {methodLabel(it.r.method).toLowerCase()}</span>
                    </>
                  )}
                </span>
                <span className="tl-amt">
                  {it.kind === 'bill'
                    ? <><b className={it.b.status !== 'ACTIVE' ? 'struck' : ''}>Rs {money(it.b.net)}</b><span>{n(it.b.paidNow) >= n(it.b.net) ? 'paid' : n(it.b.paidNow) > 0 ? `paid ${money(it.b.paidNow)}` : 'udhaar'}</span></>
                    : <><b className="ok">+ Rs {money(it.r.amount)}</b><span>received</span></>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </div>
  );
}
