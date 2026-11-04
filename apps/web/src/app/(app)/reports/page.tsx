'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import StackedColumns, { LINE_SERIES } from '@/components/Chart';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { downloadCsv, SortTh, useSort } from '@/components/Table';
import { api } from '@/lib/api';

type Tab = 'profit' | 'rice' | 'salesmen' | 'empties' | 'returns' | 'collections';
const TABS: [Tab, string][] = [
  ['profit', 'Profit'], ['rice', 'Rice bought / sold'], ['salesmen', 'Salesmen & vehicles'],
  ['empties', 'Empties'], ['returns', 'Returns & damaged'], ['collections', 'Collections'],
];
const n = (v: string | number | null | undefined) => Number(v ?? 0).toLocaleString('en-PK', { maximumFractionDigits: 0 });
const neg = (v: string | number) => (Number(v) < 0 ? 'error' : '');
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const addDays = (d: Date, k: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'lastMonth' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['lastMonth', 'Last month']];
function rangeOf(p: Preset): [string, string] {
  const t = new Date();
  if (p === 'yesterday') return [iso(addDays(t, -1)), iso(addDays(t, -1))];
  if (p === '7d') return [iso(addDays(t, -6)), iso(t)];
  if (p === 'month') return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  if (p === 'lastMonth') return [iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), iso(new Date(t.getFullYear(), t.getMonth(), 0))];
  return [iso(t), iso(t)];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Data = any;

interface Col { key: string; label: string; num?: boolean; render?: (r: Data) => ReactNode; value: (r: Data) => string | number | null }

/** Sortable table; numbers right-aligned. */
function DataTable({ cols, rows, empty = 'Nothing in this range.', rowKey }: { cols: Col[]; rows: Data[]; empty?: string; rowKey: (r: Data, i: number) => string }) {
  const { sorted, sort, toggle } = useSort<Data, string>(rows, (r, k) => cols.find((c) => c.key === k)!.value(r));
  return (
    <>
      <table className="sticky-head">
        <thead><tr>{cols.map((c) => <SortTh key={c.key} k={c.key} sort={sort} toggle={toggle} num={c.num}>{c.label}</SortTh>)}</tr></thead>
        <tbody>
          {sorted.map((r, i) => <tr key={rowKey(r, i)}>{cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : c.num ? n(c.value(r)) : c.value(r)}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={cols.length}><Empty icon="reports" title={empty} text="Try a wider date range." /></td></tr>}
        </tbody>
      </table>
    </>
  );
}

const sumLine = (rows: Data[], line: 'BOTTLES' | 'RICE', f: string) => rows.reduce((s, r) => s + Number(r.lines[line][f]), 0);
const sumTotal = (rows: Data[], f: string) => rows.reduce((s, r) => s + Number(r.total[f]), 0);

function Profit({ d, from, to, groupBy }: { d: Data; from: string; to: string; groupBy: string }) {
  const rows: Data[] = d.rows;
  const net = sumTotal(rows, 'netSales'), gross = sumTotal(rows, 'grossProfit'), exp = sumTotal(rows, 'expenses'), profit = sumTotal(rows, 'netProfit');
  const uncosted = rows.reduce((s, r) => s + r.uncostedLines, 0);

  // Every day of the range on the chart, including days with no sales.
  const chart = useMemo(() => {
    const byPeriod = new Map(rows.map((r) => [r.period, r]));
    const point = (period: string, label: string, title: string) => {
      const r = byPeriod.get(period);
      return { label, title, values: { BOTTLES: r ? Number(r.lines.BOTTLES.netSales) : 0, RICE: r ? Number(r.lines.RICE.netSales) : 0 } };
    };
    if (groupBy === 'day') {
      const out = [];
      for (let t = new Date(`${from}T00:00:00`); iso(t) <= to && out.length < 93; t = addDays(t, 1)) {
        out.push(point(iso(t), String(t.getDate()), t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })));
      }
      return out;
    }
    return rows.map((r) => point(r.period, r.period, r.period));
  }, [rows, from, to, groupBy]);

  const tile = (label: string, value: number, sub: string, icon: Parameters<typeof Icon>[0]['name'], tone = '') => (
    <div className="stat">
      <span className="label"><span className={`icon ${tone}`}><Icon name={icon} /></span>{label}</span>
      <span className={`value${value < 0 ? ' neg' : ''}`}><small>Rs</small>{n(value)}</span>
      <span className="sub">{sub}</span>
    </div>
  );
  const pct = (v: number) => (net ? `${Math.round((v / net) * 100)}% of net sales` : '—');

  return (
    <>
      <div className="stats">
        {tile('Net sales', net, `${n(sumLine(rows, 'BOTTLES', 'netSales'))} bottles · ${n(sumLine(rows, 'RICE', 'netSales'))} rice`, 'sales')}
        {tile('Gross profit', gross, pct(gross), 'trend', 'green')}
        {tile('Expenses', exp, `incl. ${n(rows.reduce((s, r) => s + Number(r.sharedExpenses), 0))} shared`, 'expenses', 'amber')}
        {tile('Net profit', profit, pct(profit), 'wallet', profit < 0 ? 'red' : 'green')}
      </div>
      {uncosted > 0 && <p className="error"><Icon name="alert" /> {uncosted} sold lines have no cost yet, so profit is overstated.</p>}
      {chart.length > 1 && (
        <section className="card">
          <div className="card-head"><h2>Net sales by {groupBy === 'month' ? 'month' : 'day'}</h2></div>
          <StackedColumns data={chart} series={LINE_SERIES} caption={`Net sales by ${groupBy}, bottles and rice`} />
        </section>
      )}
      <h2>By period</h2>
      <DataTable
        rowKey={(r) => r.period}
        rows={rows}
        empty="No sales or expenses in this range."
        cols={[
          { key: 'period', label: 'Period', value: (r) => r.period, render: (r) => <b>{r.period}</b> },
          { key: 'b', label: 'Bottles net', num: true, value: (r) => r.lines.BOTTLES.netSales },
          { key: 'r', label: 'Rice net', num: true, value: (r) => r.lines.RICE.netSales },
          { key: 'net', label: 'Net sales', num: true, value: (r) => r.total.netSales },
          { key: 'cost', label: 'Cost', num: true, value: (r) => r.total.cost },
          { key: 'gross', label: 'Gross profit', num: true, value: (r) => r.total.grossProfit, render: (r) => <span className={neg(r.total.grossProfit)}>{n(r.total.grossProfit)}</span> },
          { key: 'exp', label: 'Expenses', num: true, value: (r) => r.total.expenses },
          { key: 'np', label: 'Net profit', num: true, value: (r) => r.total.netProfit, render: (r) => <b className={neg(r.total.netProfit)}>{n(r.total.netProfit)}</b> },
          { key: 'cash', label: 'Cash with bills', num: true, value: (r) => r.cash.paidWithBills },
          { key: 'udh', label: 'Udhaar given', num: true, value: (r) => r.cash.udhaarGiven },
        ]}
      />
      {rows.length > 0 && (
        <>
          <h2>By line (whole range)</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Line</th><th className="num">Qty sold</th><th className="num">Sales</th><th className="num">Returns</th><th className="num">Net sales</th><th className="num">Cost</th><th className="num">Gross profit</th><th className="num">Expenses</th><th className="num">Net profit</th></tr></thead>
              <tbody>
                {(['BOTTLES', 'RICE'] as const).map((k) => (
                  <tr key={k}>
                    <td><span className="swatch" style={{ background: LINE_SERIES.find((s) => s.key === k)!.color }} />{k === 'BOTTLES' ? 'Bottles' : 'Rice'}</td>
                    {['qtySold', 'sales', 'returnsCredit', 'netSales', 'cost', 'grossProfit', 'expenses', 'netProfit'].map((f) => (
                      <td key={f} className={`num ${neg(sumLine(rows, k, f))}`}>{n(sumLine(rows, k, f))}</td>
                    ))}
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Total</td><td className="num">{n(sumTotal(rows, 'qtySold'))}</td><td className="num">{n(sumTotal(rows, 'sales'))}</td><td className="num">{n(sumTotal(rows, 'returnsCredit'))}</td>
                  <td className="num">{n(net)}</td><td className="num">{n(sumTotal(rows, 'cost'))}</td><td className={`num ${neg(gross)}`}>{n(gross)}</td><td className="num">{n(exp)}</td><td className={`num ${neg(profit)}`}>{n(profit)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ fontSize: 13 }}>Qty is in bottles / kg. Cost is the latest purchase price at the time of each sale. Returns credits reduce net sales; the returned stock sits as damaged until written off or sent back to the supplier.</p>
    </>
  );
}

const methods = (r: Data) => Object.entries(r.byMethod ?? {}).map(([m, v]) => `${m.toLowerCase()} ${n(v as string)}`).join(' · ');

/** Columns per tab, also used for the CSV export. */
function colsFor(tab: Tab): Record<string, Col[]> {
  const sm: Col[] = [
    { key: 'bills', label: 'Bills', num: true, value: (r) => r.bills },
    { key: 'net', label: 'Sales', num: true, value: (r) => r.net },
    { key: 'collected', label: 'Collected', num: true, value: (r) => r.collected },
    { key: 'methods', label: 'By method', value: methods, render: (r) => <span className="muted">{methods(r)}</span> },
    { key: 'udhaar', label: 'Udhaar', num: true, value: (r) => r.udhaar },
    { key: 'empties', label: 'Empties out / in', value: (r) => `${r.emptiesOut} / ${r.emptiesIn}` },
  ];
  switch (tab) {
    case 'rice': return { rows: [
      { key: 'category', label: 'Category', value: (r) => r.category },
      { key: 'product', label: 'Product', value: (r) => `${r.product}${r.size ? ` (${r.size})` : ''}`, render: (r) => <b>{r.product}{r.size && ` (${r.size})`}</b> },
      { key: 'bk', label: 'Bought kg', num: true, value: (r) => r.boughtKg },
      { key: 'bv', label: 'Bought value', num: true, value: (r) => r.boughtValue },
      { key: 'sk', label: 'Sold kg', num: true, value: (r) => r.soldKg },
      { key: 'sv', label: 'Sold value', num: true, value: (r) => r.soldValue },
    ] };
    case 'salesmen': return {
      salesmen: [{ key: 'name', label: 'Salesman', value: (r) => r.name, render: (r) => <b>{r.name}</b> }, ...sm,
        { key: 'commission', label: 'Commission', num: true, value: (r) => r.commission, render: (r) => <>{n(r.commission)}{r.commissionPercent && <span className="muted"> ({Number(r.commissionPercent)}%)</span>}</> }],
      vehicles: [{ key: 'name', label: 'Vehicle', value: (r) => r.name, render: (r) => <b>{r.name}</b> }, ...sm],
    };
    case 'empties': return { rows: [
      { key: 'customer', label: 'Customer', value: (r) => r.customer?.name ?? '', render: (r) => <>{r.customer?.name}{r.customer?.shopName && <span className="muted"> · {r.customer.shopName}</span>}</> },
      { key: 'area', label: 'Area', value: (r) => r.customer?.area ?? '' },
      { key: 'product', label: 'Product', value: (r) => r.product },
      { key: 'held', label: 'Empties held', num: true, value: (r) => r.held },
    ] };
    case 'returns': return {
      items: [
        { key: 'date', label: 'Date', value: (r) => r.date.slice(0, 10) },
        { key: 'bill', label: 'Bill', value: (r) => r.bill },
        { key: 'customer', label: 'Customer', value: (r) => r.customer },
        { key: 'product', label: 'Product', value: (r) => r.product },
        { key: 'qty', label: 'Qty', num: true, value: (r) => r.qty, render: (r) => `${n(r.qty)} ${r.unitName.toLowerCase()}` },
        { key: 'reason', label: 'Reason', value: (r) => r.reason.toLowerCase(), render: (r) => <span className={`badge ${r.reason === 'DAMAGED' ? 'red' : 'amber'}`}>{r.reason.toLowerCase()}</span> },
        { key: 'credit', label: 'Credit', num: true, value: (r) => r.credit },
      ],
      damagedOnHand: [
        { key: 'product', label: 'Product', value: (r) => r.product },
        { key: 'location', label: 'Location', value: (r) => r.location },
        { key: 'qty', label: 'Qty', num: true, value: (r) => r.qtyBase },
      ],
    };
    case 'collections': return { rows: [
      { key: 'date', label: 'Date', value: (r) => r.date },
      { key: 'user', label: 'Recorded by', value: (r) => r.user },
      { key: 'count', label: 'Receipts', num: true, value: (r) => r.count },
      { key: 'total', label: 'Total', num: true, value: (r) => r.total, render: (r) => <b>{n(r.total)}</b> },
      { key: 'methods', label: 'By method', value: methods, render: (r) => <span className="muted">{methods(r)}</span> },
    ] };
    default: return {};
  }
}

/** The arrays of rows for a tab, keyed like colsFor(). */
function rowsFor(tab: Tab, d: Data): Record<string, Data[]> {
  if (tab === 'empties') return { rows: d };
  if (tab === 'salesmen') return { salesmen: d.salesmen, vehicles: d.vehicles };
  if (tab === 'returns') return { items: d.items, damagedOnHand: d.damagedOnHand };
  return { rows: d.rows };
}

const TITLES: Record<string, string> = { salesmen: 'Salesmen', vehicles: 'Vehicles (cash to settle)', items: 'Returned items', damagedOnHand: 'Damaged stock on hand' };

function View({ tab, d }: { tab: Tab; d: Data }) {
  const cols = colsFor(tab);
  const rows = rowsFor(tab, d);
  return (
    <>
      {tab === 'returns' && (
        <div className="mini-stats">
          <div className="stat"><span className="label">Damaged credited</span><span className="value"><small>Rs</small>{n(d.credit.DAMAGED)}</span></div>
          <div className="stat"><span className="label">Expired credited</span><span className="value"><small>Rs</small>{n(d.credit.EXPIRED)}</span></div>
        </div>
      )}
      {Object.keys(cols).map((k) => (
        <div key={k}>
          {TITLES[k] && <h2>{TITLES[k]}</h2>}
          <DataTable cols={cols[k]} rows={rows[k] ?? []} rowKey={(r, i) => `${k}-${i}`} empty={tab === 'empties' ? 'No shop is holding empties.' : undefined} />
        </div>
      ))}
    </>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('profit');
  const [preset, setPreset] = useState<Preset>('today');
  const [[from, to], setRange] = useState<[string, string]>(() => rangeOf('today'));
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState<{ key: string; d: Data } | null>(null);
  const [error, setError] = useState('');

  const key = `${tab}|${from}|${to}|${tab === 'profit' ? groupBy : ''}`;
  useEffect(() => {
    const qs = new URLSearchParams({ from, to, ...(tab === 'profit' ? { groupBy } : {}) }).toString();
    let stale = false;
    api<Data>(`/reports/${tab}${tab === 'empties' ? '' : `?${qs}`}`)
      .then((d) => { if (!stale) { setData({ key: `${tab}|${from}|${to}|${tab === 'profit' ? groupBy : ''}`, d }); setError(''); } })
      .catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [tab, from, to, groupBy]);

  const choose = (p: Preset) => {
    setPreset(p);
    setRange(rangeOf(p));
    if (tab === 'profit') setGroupBy(p === 'lastMonth' || p === 'month' ? 'day' : groupBy);
  };

  const ready = data?.key === key ? data.d : null;

  function exportCsv() {
    if (!ready) return;
    const name = `${tab}-${tab === 'empties' ? iso(new Date()) : `${from}_${to}`}`;
    if (tab === 'profit') {
      const f = ['netSales', 'cost', 'grossProfit', 'expenses', 'netProfit'];
      downloadCsv(`${name}.csv`, ['Period', 'Bottles net', 'Rice net', 'Net sales', 'Cost', 'Gross profit', 'Expenses', 'Net profit', 'Cash with bills', 'Udhaar given'],
        ready.rows.map((r: Data) => [r.period, r.lines.BOTTLES.netSales, r.lines.RICE.netSales, ...f.map((k) => r.total[k]), r.cash.paidWithBills, r.cash.udhaarGiven]));
      return;
    }
    const cols = colsFor(tab), rows = rowsFor(tab, ready);
    const keys = Object.keys(cols);
    const multi = keys.length > 1;
    const head = [...(multi ? ['Section'] : []), ...cols[keys[0]].map((c) => c.label)];
    const out = keys.flatMap((k) => (rows[k] ?? []).map((r) => [...(multi ? [TITLES[k] ?? k] : []), ...cols[k].map((c) => c.value(r))]));
    downloadCsv(`${name}.csv`, head, out);
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Reports</h1><p>{tab === 'empties' ? 'As of today' : from === to ? new Date(`${from}T00:00:00`).toLocaleDateString('en-GB', { dateStyle: 'medium' }) : `${from} → ${to}`}</p></div>
        <button className="secondary btn-icon" onClick={exportCsv} disabled={!ready}><Icon name="download" />Export CSV</button>
      </div>
      <div className="tabs" role="tablist" aria-label="Report">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab !== 'empties' && (
        <div className="filters" role="group" aria-label="Date range">
          <div className="chips">
            {PRESETS.map(([p, l]) => <button key={p} type="button" className={`chip${preset === p ? ' on' : ''}`} aria-pressed={preset === p} onClick={() => choose(p)}>{l}</button>)}
          </div>
          <div className="date-range">
            <label><span className="sr-only">From</span><input type="date" value={from} max={to} onChange={(e) => { setPreset('custom'); setRange([e.target.value, to]); }} aria-label="From" /></label>
            <span className="muted">to</span>
            <label><span className="sr-only">To</span><input type="date" value={to} min={from} onChange={(e) => { setPreset('custom'); setRange([from, e.target.value]); }} aria-label="To" /></label>
          </div>
          {tab === 'profit' && (
            <div className="seg" role="radiogroup" aria-label="Group by">
              {[['day', 'By day'], ['month', 'By month'], ['none', 'One total']].map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={groupBy === v} className={groupBy === v ? 'on' : ''} onClick={() => setGroupBy(v)}>{l}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {!ready && !error && (
        <div aria-busy="true">
          {tab === 'profit' && <div className="stats">{[0, 1, 2, 3].map((i) => <span key={i} className="skeleton" style={{ height: 104 }} />)}</div>}
          <table><tbody><SkeletonRows cols={6} rows={6} /></tbody></table>
        </div>
      )}
      {ready && (tab === 'profit' ? <Profit d={ready} from={from} to={to} groupBy={groupBy} /> : <View tab={tab} d={ready} />)}
    </>
  );
}
