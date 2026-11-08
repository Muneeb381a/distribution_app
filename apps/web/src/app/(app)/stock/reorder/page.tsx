'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Empty, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { api, can, useUser } from '@/lib/api';
import { formatQty, productLabel } from '@/lib/lookups';
import { usePageTitle } from '@/lib/pageTitle';
import { useSettings } from '@/lib/settings';
import { formatDate, money, rupees, unitLabel } from '@dist/shared';

type Status = 'OUT' | 'URGENT' | 'SOON' | 'OK' | 'DEAD';
interface Row {
  productId: string; name: string; size: string | null; brand: string | null; line: 'BOTTLES' | 'RICE'; baseUnit: string;
  units: { unitName: string; factorToBase: string }[];
  onHand: string; perDay: string; daysLeft: string | null; status: Status; soldInWindow: string; lastSoldAt: string | null; idleDays: number | null;
  buy: { unitName: string | null; units: string; baseQty: string; cost: string | null } | null;
  stockValue: string | null;
  lastBought: { unitName: string; unitPrice: string; date: string; supplier: { id: string; name: string; phone: string | null } } | null;
}
interface Plan { days: number; cover: number; deadDays: number; rows: Row[]; totals: { out: number; running: number; dead: number; orderCost: string; deadValue: string } }

const n = (v: string | number | null | undefined) => Number(v ?? 0);
const WINDOWS = [7, 14, 30, 60, 90];
const COVERS = [7, 14, 21, 30];
const waNumber = (p: string | null) => { const d = (p ?? '').replace(/\D/g, ''); if (d.length < 10) return null; return d.startsWith('92') ? d : d.startsWith('0') ? `92${d.slice(1)}` : d.length === 10 ? `92${d}` : d; };
const STATUS: Record<Status, [string, string]> = { OUT: ['Out of stock', 'red'], URGENT: ['Buy now', 'red'], SOON: ['Buy soon', 'amber'], OK: ['Fine for now', 'green'], DEAD: ['Not selling', ''] };

/** Reorder plan: from how fast each product really sells, what to buy now, and which stock has stopped moving. */
export default function ReorderPage() {
  usePageTitle('Reorder plan');
  const user = useUser();
  const biz = useSettings().businessName;
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [cover, setCover] = useState(14);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  const [showOk, setShowOk] = useState(false);

  useEffect(() => {
    let stale = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlan(null);
    api<Plan>(`/stock/reorder?days=${days}&cover=${cover}`).then((p) => { if (!stale) { setPlan(p); setError(''); } }).catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [days, cover]);

  const buyRows = useMemo(() => (plan?.rows ?? []).filter((r) => r.status === 'OUT' || r.status === 'URGENT' || r.status === 'SOON'), [plan]);
  const dead = useMemo(() => (plan?.rows ?? []).filter((r) => r.status === 'DEAD'), [plan]);
  const fine = useMemo(() => (plan?.rows ?? []).filter((r) => r.status === 'OK'), [plan]);
  // The same list, one block per supplier it was last bought from, ready to send.
  const bySupplier = useMemo(() => {
    const m = new Map<string, { id: string | null; name: string; phone: string | null; rows: Row[] }>();
    for (const r of buyRows.filter((x) => x.buy)) {
      const s = r.lastBought?.supplier;
      const key = s?.id ?? 'none';
      const g = m.get(key) ?? { id: s?.id ?? null, name: s?.name ?? 'No supplier yet (never bought)', phone: s?.phone ?? null, rows: [] };
      g.rows.push(r);
      m.set(key, g);
    }
    return [...m.values()];
  }, [buyRows]);

  if (!user) return null;
  if (!can(user, 'REPORT_VIEW')) return <p className="error">You need the report permission to see the reorder plan.</p>;

  const line = (r: Row) => `${productLabel(r)}: ${n(r.buy!.units)} ${unitLabel(r.buy!.unitName ?? r.baseUnit)}`;
  const orderText = (g: { id: string | null; name: string; rows: Row[] }) => `Assalam o Alaikum${g.id === null ? '' : ` ${g.name}`},\nOrder from ${biz}:\n${g.rows.map((r) => `- ${line(r)}`).join('\n')}\nPlease confirm the rates and delivery day. Thank you.`;
  async function copy(g: { id: string | null; name: string; rows: Row[] }) {
    try { await navigator.clipboard.writeText(orderText(g)); toast.success('Order list copied'); } catch { toast.error('Could not copy'); }
  }
  function send(g: { id: string | null; phone: string | null; name: string; rows: Row[] }) {
    const num = waNumber(g.phone);
    window.open(`https://wa.me/${num ?? ''}?text=${encodeURIComponent(orderText(g))}`, '_blank', 'noopener');
  }

  const t = plan?.totals;
  return (
    <>
      <Link className="back" href="/stock"><Icon name="chevronLeft" />Stock</Link>
      <div className="page-head"><div><h1>Reorder plan</h1><p>What to buy, worked out from how fast each product really sells.</p></div></div>

      <div className="ro-controls">
        <div className="ro-ctl"><span>Look at the last</span><div className="chips" role="group" aria-label="Days of sales to look at">{WINDOWS.map((d) => <button key={d} type="button" className={`chip${days === d ? ' on' : ''}`} aria-pressed={days === d} onClick={() => setDays(d)}>{d} days</button>)}</div></div>
        <div className="ro-ctl"><span>Buy enough for</span><div className="chips" role="group" aria-label="Days to cover">{COVERS.map((d) => <button key={d} type="button" className={`chip${cover === d ? ' on' : ''}`} aria-pressed={cover === d} onClick={() => setCover(d)}>{d} days</button>)}</div></div>
      </div>

      {error && <p className="error">{error}</p>}
      {!plan && !error && <div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}</div>}

      {plan && t && (
        <>
          <StatTiles items={[
            { label: 'Out of stock', value: t.out, sub: t.out ? 'but they sell' : 'nothing selling is out', icon: 'ban', tone: t.out ? 'red' : 'green' },
            { label: 'Running low', value: t.running, sub: 'under a week of stock left', icon: 'alert', tone: t.running ? 'amber' : 'green' },
            { label: 'Cost of this order', value: <><small>Rs</small>{rupees(t.orderCost)}</>, sub: 'at the last price you paid', icon: 'purchases' },
            { label: 'Stock not selling', value: <><small>Rs</small>{rupees(t.deadValue)}</>, sub: `${t.dead} product${t.dead === 1 ? '' : 's'}, nothing sold in ${plan.deadDays} days`, icon: 'stock', tone: t.dead ? 'amber' : 'green' },
          ]} />

          <div className="section-head"><h2>Buy now</h2><span className="count-pill">{buyRows.length}</span></div>
          {buyRows.length === 0 ? (
            <Empty icon="check" title="Nothing needs buying" text={`Every product that sells has more than a week of stock at the speed of the last ${plan.days} days.`} />
          ) : (
            <table className="sticky-head ro-table">
              <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Sells a day</th><th>Days left</th><th className="num">Buy</th><th>Last bought</th></tr></thead>
              <tbody>
                {buyRows.map((r) => {
                  const left = r.daysLeft === null ? null : n(r.daysLeft);
                  const [label, tone] = STATUS[r.status];
                  return (
                    <tr key={r.productId}>
                      <td>
                        <span className="person">
                          <span className={`prod-tile ${r.line === 'BOTTLES' ? 'bottles' : 'rice'}`} style={{ width: 36, height: 36 }}><Icon name="products" /></span>
                          <span className="person-text"><b>{productLabel(r)}</b><span>{r.brand ?? (r.line === 'BOTTLES' ? 'Bottles' : 'Rice')}</span></span>
                        </span>
                      </td>
                      <td className="num">{formatQty(r.onHand, r.units, r.baseUnit)}</td>
                      <td className="num">{formatQty(String(Math.round(n(r.perDay) * 10) / 10), r.units, r.baseUnit)}</td>
                      <td>
                        <span className="ro-left">
                          <span className="meter" aria-hidden="true"><span className={left !== null && left <= 3 ? 'over' : ''} style={{ width: `${Math.min(100, ((left ?? 0) / 14) * 100)}%`, background: left !== null && left <= 3 ? 'var(--danger)' : 'var(--warn)' }} /></span>
                          <span className={`badge ${tone}`}>{r.status === 'OUT' ? label : `${Math.max(0, Math.round((left ?? 0) * 10) / 10)} days`}</span>
                        </span>
                      </td>
                      <td className="num">{r.buy ? <span className="ro-buy"><b>{n(r.buy.units)} {unitLabel(r.buy.unitName ?? r.baseUnit)}</b>{r.buy.cost && <span>≈ Rs {rupees(r.buy.cost)}</span>}</span> : '—'}</td>
                      <td>{r.lastBought ? <span className="ro-last"><b>{r.lastBought.supplier.name}</b><span>Rs {money(r.lastBought.unitPrice)} / {unitLabel(r.lastBought.unitName)} · {formatDate(r.lastBought.date, 'short')}</span></span> : <span className="muted">Never bought</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {bySupplier.length > 0 && (
            <>
              <div className="section-head"><h2>Order list by supplier</h2></div>
              <div className="ro-orders">
                {bySupplier.map((g) => (
                  <section key={g.id ?? 'none'} className="card ro-order">
                    <header><b>{g.name}</b><span className="count-pill">{g.rows.length}</span></header>
                    <ul>{g.rows.map((r) => <li key={r.productId}><span>{productLabel(r)}</span><b>{n(r.buy!.units)} {unitLabel(r.buy!.unitName ?? r.baseUnit)}</b></li>)}</ul>
                    <footer>
                      <button type="button" className="secondary" onClick={() => copy(g)}><Icon name="copy" />Copy</button>
                      <button type="button" className="wa" onClick={() => send(g)} title={g.phone ? 'Open WhatsApp with the list ready' : 'No phone saved: pick a contact in WhatsApp'}><Icon name="message" />WhatsApp</button>
                    </footer>
                  </section>
                ))}
              </div>
            </>
          )}

          {dead.length > 0 && (
            <>
              <div className="section-head"><h2>Stock that is not selling</h2><span className="count-pill">{dead.length}</span></div>
              <p className="muted ro-hint">Nothing sold for {plan.deadDays} days or more. Money is sitting on the shelf: think of a discount, a bundle, or sending it back to the supplier.</p>
              <ul className="ro-dead">
                {dead.map((r) => (
                  <li key={r.productId} className="card">
                    <span className="person"><span className={`prod-tile ${r.line === 'BOTTLES' ? 'bottles' : 'rice'}`} style={{ width: 36, height: 36 }}><Icon name="products" /></span><span className="person-text"><b>{productLabel(r)}</b><span>{r.lastSoldAt ? `last sold ${formatDate(r.lastSoldAt, 'short')}` : 'never sold'}</span></span></span>
                    <span className="ro-dead-n"><b>{formatQty(r.onHand, r.units, r.baseUnit)}</b>{r.stockValue && <span>≈ Rs {rupees(r.stockValue)} tied up</span>}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {fine.length > 0 && (
            <div className="ro-fine">
              <button type="button" className="secondary" onClick={() => setShowOk(!showOk)}>{showOk ? 'Hide' : 'Show'} the {fine.length} product{fine.length === 1 ? '' : 's'} that are fine</button>
              {showOk && (
                <table className="ro-table" style={{ marginTop: 12 }}>
                  <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Sells a day</th><th className="num">Days left</th></tr></thead>
                  <tbody>{fine.map((r) => <tr key={r.productId}><td><b>{productLabel(r)}</b></td><td className="num">{formatQty(r.onHand, r.units, r.baseUnit)}</td><td className="num">{n(r.perDay) ? formatQty(String(Math.round(n(r.perDay) * 10) / 10), r.units, r.baseUnit) : '—'}</td><td className="num">{r.daysLeft === null ? '—' : `${Math.round(n(r.daysLeft))} days`}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          )}
          <p className="muted ro-hint">Sells a day is the average over the last {plan.days} days (cancelled bills left out). The order covers {plan.cover} days of selling and is rounded up to whole cartons or bags, in the unit you last bought.</p>
        </>
      )}
    </>
  );
}
