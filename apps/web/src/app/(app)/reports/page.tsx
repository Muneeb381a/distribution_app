'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';

type Tab = 'profit' | 'rice' | 'salesmen' | 'empties' | 'returns' | 'collections';
const TABS: [Tab, string][] = [
  ['profit', 'Profit'], ['rice', 'Rice bought / sold'], ['salesmen', 'Salesmen & vehicles'],
  ['empties', 'Empties'], ['returns', 'Returns & damaged'], ['collections', 'Collections'],
];
const today = () => new Date().toISOString().slice(0, 10);
const n = (v: string | number) => Number(v).toLocaleString();
const neg = (v: string | number) => (Number(v) < 0 ? 'error' : '');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Data = any;

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <table>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{children}{empty && <tr><td colSpan={head.length} className="muted">Nothing in this range.</td></tr>}</tbody>
    </table>
  );
}

function Profit({ d }: { d: Data }) {
  return (
    <>
      {d.rows.map((r: Data) => (
        <div className="card" key={r.period}>
          <h2 style={{ marginTop: 0 }}>{r.period}</h2>
          <Table head={['', 'Qty sold', 'Sales', 'Returns', 'Net sales', 'Cost', 'Gross profit', 'Expenses', 'Net profit']}>
            {(['BOTTLES', 'RICE'] as const).map((k) => {
              const l = r.lines[k];
              return (
                <tr key={k}>
                  <td>{k === 'BOTTLES' ? 'Bottles' : 'Rice'}</td><td>{n(l.qtySold)}</td><td>{n(l.sales)}</td><td>{n(l.returnsCredit)}</td>
                  <td>{n(l.netSales)}</td><td>{n(l.cost)}</td><td className={neg(l.grossProfit)}>{n(l.grossProfit)}</td>
                  <td>{n(l.expenses)}</td><td className={neg(l.netProfit)}><strong>{n(l.netProfit)}</strong></td>
                </tr>
              );
            })}
            <tr><td className="muted">Shared (rent, bills…)</td><td colSpan={6} /><td>{n(r.sharedExpenses)}</td><td /></tr>
            <tr style={{ fontWeight: 700 }}>
              <td>Total</td><td /><td>{n(r.total.sales)}</td><td>{n(r.total.returnsCredit)}</td><td>{n(r.total.netSales)}</td><td>{n(r.total.cost)}</td>
              <td className={neg(r.total.grossProfit)}>{n(r.total.grossProfit)}</td><td>{n(r.total.expenses)}</td><td className={neg(r.total.netProfit)}>{n(r.total.netProfit)}</td>
            </tr>
          </Table>
          <p className="muted">
            Cash with bills {n(r.cash.paidWithBills)} · other receipts (old dues) {n(r.cash.otherReceipts)} · udhaar given {n(r.cash.udhaarGiven)}
            {r.uncostedLines > 0 && <span className="error"> · {r.uncostedLines} sold lines have no cost yet, so profit is overstated</span>}
          </p>
        </div>
      ))}
      {!d.rows.length && <p className="muted">No sales or expenses in this range.</p>}
      <p className="muted">Qty is in bottles / kg. Cost is the latest purchase price at the time of each sale. Returns credits reduce net sales; the returned stock sits as damaged until written off or sent back to the supplier.</p>
    </>
  );
}

function View({ tab, d }: { tab: Tab; d: Data }) {
  if (tab === 'profit') return <Profit d={d} />;
  if (tab === 'rice') {
    return (
      <Table head={['Category', 'Product', 'Bought kg', 'Bought value', 'Sold kg', 'Sold value']} empty={!d.rows.length}>
        {d.rows.map((r: Data) => (
          <tr key={r.productId}><td>{r.category}</td><td>{r.product}{r.size && ` (${r.size})`}</td><td>{n(r.boughtKg)}</td><td>{n(r.boughtValue)}</td><td>{n(r.soldKg)}</td><td>{n(r.soldValue)}</td></tr>
        ))}
      </Table>
    );
  }
  if (tab === 'salesmen') {
    const cols = ['Bills', 'Sales', 'Collected with bills', 'Udhaar', 'Empties out / in'];
    const cells = (r: Data) => (
      <><td>{r.bills}</td><td>{n(r.net)}</td><td>{n(r.collected)}{Object.entries(r.byMethod).map(([m, v]) => <span className="muted" key={m}> · {m.toLowerCase()} {n(v as string)}</span>)}</td><td>{n(r.udhaar)}</td><td>{r.emptiesOut} / {r.emptiesIn}</td></>
    );
    return (
      <>
        <h2>Salesmen</h2>
        <Table head={['Salesman', ...cols, 'Commission']} empty={!d.salesmen.length}>
          {d.salesmen.map((r: Data) => <tr key={r.employeeId}><td>{r.name}</td>{cells(r)}<td>{n(r.commission)}{r.commissionPercent && <span className="muted"> ({Number(r.commissionPercent)}%)</span>}</td></tr>)}
        </Table>
        <h2>Vehicles (cash to settle)</h2>
        <Table head={['Vehicle', ...cols]} empty={!d.vehicles.length}>
          {d.vehicles.map((r: Data) => <tr key={r.locationId}><td>{r.name}</td>{cells(r)}</tr>)}
        </Table>
      </>
    );
  }
  if (tab === 'empties') {
    return (
      <Table head={['Customer', 'Area', 'Product', 'Empties held']} empty={!d.length}>
        {d.map((r: Data) => <tr key={r.customerId + r.productId}><td>{r.customer?.name}{r.customer?.shopName && <span className="muted"> · {r.customer.shopName}</span>}</td><td>{r.customer?.area}</td><td>{r.product}</td><td>{r.held}</td></tr>)}
      </Table>
    );
  }
  if (tab === 'returns') {
    return (
      <>
        <p>Credited: damaged <strong>{n(d.credit.DAMAGED)}</strong> · expired <strong>{n(d.credit.EXPIRED)}</strong></p>
        <Table head={['Date', 'Bill', 'Customer', 'Product', 'Qty', 'Reason', 'Credit']} empty={!d.items.length}>
          {d.items.map((r: Data, i: number) => <tr key={i}><td>{r.date.slice(0, 10)}</td><td>{r.bill}</td><td>{r.customer}</td><td>{r.product}</td><td>{n(r.qty)} {r.unitName.toLowerCase()}</td><td>{r.reason.toLowerCase()}</td><td>{n(r.credit)}</td></tr>)}
        </Table>
        <h2>Damaged stock on hand</h2>
        <Table head={['Product', 'Location', 'Qty']} empty={!d.damagedOnHand.length}>
          {d.damagedOnHand.map((r: Data, i: number) => <tr key={i}><td>{r.product}</td><td>{r.location}</td><td>{n(r.qtyBase)}</td></tr>)}
        </Table>
      </>
    );
  }
  return (
    <Table head={['Date', 'Recorded by', 'Receipts', 'Total', 'By method']} empty={!d.rows.length}>
      {d.rows.map((r: Data) => <tr key={r.date + r.user}><td>{r.date}</td><td>{r.user}</td><td>{r.count}</td><td>{n(r.total)}</td><td className="muted">{Object.entries(r.byMethod).map(([m, v]) => `${m.toLowerCase()} ${n(v as string)}`).join(' · ')}</td></tr>)}
    </Table>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('profit');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState<{ tab: Tab; d: Data } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const qs = new URLSearchParams({ from, to, ...(tab === 'profit' ? { groupBy } : {}) }).toString();
    api<Data>(`/reports/${tab}${tab === 'empties' ? '' : `?${qs}`}`)
      .then((d) => { setData({ tab, d }); setError(''); })
      .catch((e) => setError(e.message));
  }, [tab, from, to, groupBy]);

  const preset = (days: number | 'month') => {
    const end = new Date();
    const start = days === 'month' ? new Date(end.getFullYear(), end.getMonth(), 1) : new Date(end.getTime() - (days - 1) * 86_400_000);
    const f = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
    setFrom(f(start));
    setTo(f(end));
    if (tab === 'profit') setGroupBy(days === 'month' ? 'none' : 'day');
  };

  return (
    <>
      <h1>Reports</h1>
      <div className="toolbar">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab !== 'empties' && (
        <div className="toolbar">
          <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="secondary" onClick={() => preset(1)}>Today</button>
          <button className="secondary" onClick={() => preset(7)}>7 days</button>
          <button className="secondary" onClick={() => preset('month')}>This month</button>
          {tab === 'profit' && (
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="day">By day</option><option value="month">By month</option><option value="none">One total</option>
            </select>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {data?.tab === tab && <View tab={tab} d={data.d} />}
    </>
  );
}
