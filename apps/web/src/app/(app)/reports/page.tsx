'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import StackedColumns, { LINE_SERIES } from '@/components/Chart';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { downloadCsv, SortTh, useSort } from '@/components/Table';
import { api } from '@/lib/api';
import { addDays, lineLabel, localDay, presetRange, rupees } from '@dist/shared';

type Tab = 'profit' | 'rice' | 'salesmen' | 'empties' | 'returns' | 'collections';
const TABS: [Tab, string][] = [
  ['profit', 'Profit'], ['rice', 'Rice bought / sold'], ['salesmen', 'Salesmen & vehicles'],
  ['empties', 'Empties'], ['returns', 'Returns & damaged'], ['collections', 'Collections'],
];
const neg = (v: string | number) => (Number(v) < 0 ? 'error' : '');

type Preset = 'today' | 'yesterday' | '7d' | 'month' | 'lastMonth' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['lastMonth', 'Last month']];
const rangeOf = (p: Preset): [string, string] => presetRange(p === 'custom' ? 'today' : p);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Data = any;

interface Col { key: string; label: string; num?: boolean; render?: (r: Data) => ReactNode; value: (r: Data) => string | number | null }

/** Sortable table; numbers right-aligned. */
function DataTable({ cols, rows, empty = 'Nothing in this range.', rowKey }: { cols: Col[]; rows: Data[]; empty?: string; rowKey: (r: Data, i: number) => string }) {
  const { sorted, sort, toggle } = useSort<Data, string>(rows, (r, k) => cols.find((c) => c.key === k)!.value(r));
  return (
    // Wide report tables scroll sideways inside their box instead of widening the page.
    <div className="table-wrap">
      <table>
        <thead><tr>{cols.map((c) => <SortTh key={c.key} k={c.key} sort={sort} toggle={toggle} num={c.num}>{c.label}</SortTh>)}</tr></thead>
        <tbody>
          {sorted.map((r, i) => <tr key={rowKey(r, i)}>{cols.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : c.num ? rupees(c.value(r)) : c.value(r)}</td>)}</tr>)}
          {!rows.length && <tr><td colSpan={cols.length}><Empty icon="reports" title={empty} text="Try a wider date range." /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const sumLine = (rows: Data[], line: 'BOTTLES' | 'RICE', f: string) => rows.reduce((s, r) => s + Number(r.lines[line][f]), 0);
const sumTotal = (rows: Data[], f: string) => rows.reduce((s, r) => s + Number(r.total[f]), 0);

function Profit({ d, from, to, groupBy }: { d: Data; from: string; to: string; groupBy: string }) {
  const rows: Data[] = d.rows;
  const net = sumTotal(rows, 'netSales'), gross = sumTotal(rows, 'grossProfit'), exp = sumTotal(rows, 'expenses'), profit = sumTotal(rows, 'netProfit');
  const lineNet = { BOTTLES: sumLine(rows, 'BOTTLES', 'netSales'), RICE: sumLine(rows, 'RICE', 'netSales') };
  const lineGross = { BOTTLES: sumLine(rows, 'BOTTLES', 'grossProfit'), RICE: sumLine(rows, 'RICE', 'grossProfit') };
  const uncosted = rows.reduce((s, r) => s + r.uncostedLines, 0);
  const places: { locationId: string | null; name: string; type: string | null; amount: string }[] = d.expensesByPlace ?? [];
  const categories: { category: string; amount: string }[] = d.expensesByCategory ?? [];

  // Every day of the range on the chart, including days with no sales.
  const chart = useMemo(() => {
    const byPeriod = new Map(rows.map((r) => [r.period, r]));
    const point = (period: string, label: string, title: string) => {
      const r = byPeriod.get(period);
      return { label, title, values: { BOTTLES: r ? Number(r.lines.BOTTLES.netSales) : 0, RICE: r ? Number(r.lines.RICE.netSales) : 0 } };
    };
    if (groupBy === 'day') {
      const out = [];
      for (let t = new Date(`${from}T00:00:00`); localDay(t) <= to && out.length < 93; t = addDays(t, 1)) {
        out.push(point(localDay(t), String(t.getDate()), t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })));
      }
      return out;
    }
    return rows.map((r) => point(r.period, r.period, r.period));
  }, [rows, from, to, groupBy]);

  const tile = (label: string, value: number, sub: string, icon: Parameters<typeof Icon>[0]['name'], tone = '') => (
    <div className="stat">
      <span className="label"><span className={`icon ${tone}`}><Icon name={icon} /></span>{label}</span>
      <span className={`value${value < 0 ? ' neg' : ''}`}><small>Rs</small>{rupees(value)}</span>
      <span className="sub">{sub}</span>
    </div>
  );
  /** Profit as a share of the sales it came from: "18% margin". */
  const margin = (p: number, sales: number) => (sales ? `${Math.round((p / sales) * 100)}% margin` : 'No sales');
  const placeLabel = (p: (typeof places)[number]) => (p.type === 'GODOWN' ? 'Godown' : p.type === 'SHOP' ? 'Shop' : 'Salaries, office and other');
  const biggestPlace = Math.max(1, ...places.map((p) => Number(p.amount)));
  const biggestCat = Math.max(1, ...categories.map((c) => Number(c.amount)));

  return (
    <>
      <div className="stats profit-stats">
        {tile('Bottles profit', lineGross.BOTTLES, `${margin(lineGross.BOTTLES, lineNet.BOTTLES)} on Rs ${rupees(lineNet.BOTTLES)}`, 'products', 'blue')}
        {tile('Rice profit', lineGross.RICE, `${margin(lineGross.RICE, lineNet.RICE)} on Rs ${rupees(lineNet.RICE)}`, 'stock', 'amber')}
        {tile('Both together', gross, `${margin(gross, net)} on Rs ${rupees(net)} sales`, 'trend', 'green')}
        {tile('Expenses', exp, places.length ? places.slice(0, 2).map((p) => `${p.name} ${rupees(p.amount)}`).join(' · ') : 'None in this range', 'expenses', 'amber')}
        {tile('Net profit', profit, 'Both lines, after all expenses', 'wallet', profit < 0 ? 'red' : 'green')}
      </div>
      {uncosted > 0 && <p className="error"><Icon name="alert" /> {uncosted} sold lines have no cost yet, so profit is overstated.</p>}

      {rows.length > 0 && (
        <section className="card profit-sheet">
          <div className="card-head"><h2>Profit and loss</h2><span className="muted" style={{ fontSize: 13 }}>{from === to ? from : `${from} to ${to}`}</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th /><th className="num hide-sm">Net sales</th><th className="num hide-sm">Cost</th><th className="num">Profit</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {(['BOTTLES', 'RICE'] as const).map((k) => (
                  <tr key={k}>
                    <td><span className="swatch" style={{ background: LINE_SERIES.find((s) => s.key === k)!.color }} />{lineLabel(k)}</td>
                    <td className="num hide-sm">{rupees(lineNet[k])}</td>
                    <td className="num hide-sm">{rupees(sumLine(rows, k, 'cost'))}</td>
                    <td className={`num ${neg(lineGross[k])}`}><b>{rupees(lineGross[k])}</b></td>
                    <td className="num muted">{lineNet[k] ? `${Math.round((lineGross[k] / lineNet[k]) * 100)}%` : '—'}</td>
                  </tr>
                ))}
                <tr className="total-row">
                  <td>Both lines</td><td className="num hide-sm">{rupees(net)}</td><td className="num hide-sm">{rupees(sumTotal(rows, 'cost'))}</td>
                  <td className={`num ${neg(gross)}`}>{rupees(gross)}</td><td className="num">{net ? `${Math.round((gross / net) * 100)}%` : '—'}</td>
                </tr>
                {places.map((p) => (
                  <tr key={p.locationId ?? 'general'} className="pl-minus">
                    <td>Less expenses · {p.name}</td><td className="hide-sm" /><td className="hide-sm" /><td className="num amt-debit">-{rupees(p.amount)}</td><td />
                  </tr>
                ))}
                <tr className="total-row pl-net">
                  <td>Net profit</td><td className="hide-sm" /><td className="hide-sm" /><td className={`num ${neg(profit)}`}>{rupees(profit)}</td><td className="num">{net ? `${Math.round((profit / net) * 100)}%` : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '10px 0 0' }}>Each line&apos;s profit is its net sales minus the purchase cost of what was sold. Expenses are kept together and come off the combined profit.</p>
        </section>
      )}

      {places.length > 0 && (
        <div className="dash-grid two-even">
          <section className="card">
            <div className="card-head"><h2>Expenses by place</h2></div>
            <ul className="list">
              {places.map((p) => (
                <li key={p.locationId ?? 'general'} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span><b>{p.name}</b>{placeLabel(p).toLowerCase() !== p.name.toLowerCase() && <span className="muted" style={{ fontSize: 12.5 }}> {placeLabel(p)}</span>}</span>
                    <span className="amt">Rs {rupees(p.amount)}</span>
                  </span>
                  <span className="meter" aria-hidden="true"><span style={{ width: `${(Number(p.amount) / biggestPlace) * 100}%`, background: 'var(--accent)' }} /></span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <div className="card-head"><h2>Expenses by category</h2></div>
            <ul className="list">
              {categories.slice(0, 8).map((c) => (
                <li key={c.category} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{c.category}</span><span className="amt">Rs {rupees(c.amount)}</span></span>
                  <span className="meter" aria-hidden="true"><span style={{ width: `${(Number(c.amount) / biggestCat) * 100}%`, background: 'var(--warn)' }} /></span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

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
          { key: 'period', label: 'Period', value: (r) => r.period, render: (r) => <b style={{ whiteSpace: 'nowrap' }}>{r.period}</b> },
          { key: 'net', label: 'Net sales', num: true, value: (r) => r.total.netSales },
          { key: 'bp', label: 'Bottles profit', num: true, value: (r) => r.lines.BOTTLES.grossProfit, render: (r) => <span className={neg(r.lines.BOTTLES.grossProfit)}>{rupees(r.lines.BOTTLES.grossProfit)}</span> },
          { key: 'rp', label: 'Rice profit', num: true, value: (r) => r.lines.RICE.grossProfit, render: (r) => <span className={neg(r.lines.RICE.grossProfit)}>{rupees(r.lines.RICE.grossProfit)}</span> },
          { key: 'gross', label: 'Both', num: true, value: (r) => r.total.grossProfit, render: (r) => <span className={neg(r.total.grossProfit)}>{rupees(r.total.grossProfit)}</span> },
          { key: 'exp', label: 'Expenses', num: true, value: (r) => r.total.expenses },
          { key: 'np', label: 'Net profit', num: true, value: (r) => r.total.netProfit, render: (r) => <b className={neg(r.total.netProfit)}>{rupees(r.total.netProfit)}</b> },
          { key: 'cash', label: 'Cash with bills', num: true, value: (r) => r.cash.paidWithBills },
          { key: 'udh', label: 'Udhaar given', num: true, value: (r) => r.cash.udhaarGiven },
        ]}
      />
      {rows.length > 0 && (
        <>
          <h2>Sales detail by line</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Line</th><th className="num">Qty sold</th><th className="num">Sales</th><th className="num">Returns</th><th className="num">Net sales</th><th className="num">Cost</th><th className="num">Gross profit</th></tr></thead>
              <tbody>
                {(['BOTTLES', 'RICE'] as const).map((k) => (
                  <tr key={k}>
                    <td><span className="swatch" style={{ background: LINE_SERIES.find((s) => s.key === k)!.color }} />{lineLabel(k)}</td>
                    {['qtySold', 'sales', 'returnsCredit', 'netSales', 'cost', 'grossProfit'].map((f) => (
                      <td key={f} className={`num ${neg(sumLine(rows, k, f))}`}>{rupees(sumLine(rows, k, f))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ fontSize: 13 }}>Qty is in bottles / kg. Cost is the latest purchase price at the time of each sale. Returns credits reduce net sales; the returned stock sits as damaged until written off or sent back to the supplier.</p>
    </>
  );
}

const methods = (r: Data) => Object.entries(r.byMethod ?? {}).map(([m, v]) => `${m.toLowerCase()} ${rupees(v as string)}`).join(' · ');

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
        { key: 'commission', label: 'Commission', num: true, value: (r) => r.commission, render: (r) => <>{rupees(r.commission)}{r.commissionPercent && <span className="muted"> ({Number(r.commissionPercent)}%)</span>}</> }],
      vehicles: [{ key: 'name', label: 'Vehicle', value: (r) => r.name, render: (r) => <b>{r.name}</b> }, ...sm],
    };
    case 'empties': return { customers: [
      { key: 'customer', label: 'Customer', value: (r) => r.customer?.name ?? '', render: (r) => <>{r.customer?.name}{r.customer?.shopName && <span className="muted"> · {r.customer.shopName}</span>}</> },
      { key: 'area', label: 'Area', value: (r) => r.customer?.area ?? '' },
      { key: 'product', label: 'Product', value: (r) => r.product },
      { key: 'held', label: 'Empties held', num: true, value: (r) => r.held },
    ], suppliers: [
      { key: 'supplier', label: 'Supplier', value: (r) => r.supplier ?? '', render: (r) => <b>{r.supplier}</b> },
      { key: 'product', label: 'Product', value: (r) => r.product ?? '' },
      { key: 'owed', label: 'Position', num: true, value: (r) => r.owed,
        render: (r) => (r.owed > 0 ? <span className="badge amber">{r.owed} to return</span> : <span className="badge blue">supplier owes us {-r.owed}</span>) },
    ] };
    case 'returns': return {
      items: [
        { key: 'date', label: 'Date', value: (r) => r.date.slice(0, 10) },
        { key: 'bill', label: 'Bill', value: (r) => r.bill },
        { key: 'customer', label: 'Customer', value: (r) => r.customer },
        { key: 'product', label: 'Product', value: (r) => r.product },
        { key: 'qty', label: 'Qty', num: true, value: (r) => r.qty, render: (r) => `${rupees(r.qty)} ${r.unitName.toLowerCase()}` },
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
      { key: 'total', label: 'Total', num: true, value: (r) => r.total, render: (r) => <b>{rupees(r.total)}</b> },
      { key: 'methods', label: 'By method', value: methods, render: (r) => <span className="muted">{methods(r)}</span> },
    ] };
    default: return {};
  }
}

/** The arrays of rows for a tab, keyed like colsFor(). */
function rowsFor(tab: Tab, d: Data): Record<string, Data[]> {
  if (tab === 'empties') return { customers: d.customers, suppliers: d.suppliers };
  if (tab === 'salesmen') return { salesmen: d.salesmen, vehicles: d.vehicles };
  if (tab === 'returns') return { items: d.items, damagedOnHand: d.damagedOnHand };
  return { rows: d.rows };
}

const EMPTY: Record<string, string> = { customers: 'No shop is holding empties.', suppliers: 'Nothing owed to or by suppliers.' };
const TITLES: Record<string, string> = { customers: 'Held by customers', suppliers: 'Owed to suppliers', salesmen: 'Salesmen', vehicles: 'Vehicles (cash to settle)', items: 'Returned items', damagedOnHand: 'Damaged stock on hand' };

function View({ tab, d }: { tab: Tab; d: Data }) {
  const cols = colsFor(tab);
  const rows = rowsFor(tab, d);
  return (
    <>
      {tab === 'returns' && (
        <div className="mini-stats">
          <div className="stat"><span className="label">Damaged credited</span><span className="value"><small>Rs</small>{rupees(d.credit.DAMAGED)}</span></div>
          <div className="stat"><span className="label">Expired credited</span><span className="value"><small>Rs</small>{rupees(d.credit.EXPIRED)}</span></div>
        </div>
      )}
      {Object.keys(cols).map((k) => (
        <div key={k}>
          {TITLES[k] && <h2>{TITLES[k]}</h2>}
          <DataTable cols={cols[k]} rows={rows[k] ?? []} rowKey={(r, i) => `${k}-${i}`} empty={EMPTY[k]} />
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
    // Empties combines what customers hold with what we owe suppliers.
    const req: Promise<Data> = tab === 'empties'
      ? Promise.all([api<Data>('/reports/empties'), api<Data>('/reports/supplier-empties')]).then(([customers, suppliers]) => ({ customers, suppliers }))
      : api<Data>(`/reports/${tab}?${qs}`);
    req
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
    const name = `${tab}-${tab === 'empties' ? localDay(new Date()) : `${from}_${to}`}`;
    if (tab === 'profit') {
      downloadCsv(`${name}.csv`, ['Period', 'Bottles net sales', 'Bottles profit', 'Rice net sales', 'Rice profit', 'Net sales', 'Cost', 'Gross profit (both)', 'Expenses', 'Net profit', 'Cash with bills', 'Udhaar given'],
        ready.rows.map((r: Data) => [r.period, r.lines.BOTTLES.netSales, r.lines.BOTTLES.grossProfit, r.lines.RICE.netSales, r.lines.RICE.grossProfit,
          r.total.netSales, r.total.cost, r.total.grossProfit, r.total.expenses, r.total.netProfit, r.cash.paidWithBills, r.cash.udhaarGiven]));
      return;
    }
    const cols = colsFor(tab), rows = rowsFor(tab, ready);
    const keys = Object.keys(cols);
    const body = (k: string) => (rows[k] ?? []).map((r) => cols[k].map((c) => c.value(r)));
    if (keys.length === 1) {
      downloadCsv(`${name}.csv`, cols[keys[0]].map((c) => c.label), body(keys[0]));
      return;
    }
    // Sections have different columns: each gets its own title and header row.
    const out = keys.flatMap((k, i) => [...(i ? [[]] : []), [TITLES[k] ?? k], cols[k].map((c) => c.label), ...body(k)]);
    downloadCsv(`${name}.csv`, [TABS.find(([t]) => t === tab)?.[1] ?? tab], out);
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
          {tab === 'profit' && <div className="stats profit-stats">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="skeleton" style={{ height: 104 }} />)}</div>}
          <table><tbody><SkeletonRows cols={6} rows={6} /></tbody></table>
        </div>
      )}
      {ready && (tab === 'profit' ? <Profit d={ready} from={from} to={to} groupBy={groupBy} /> : <View tab={tab} d={ready} />)}
    </>
  );
}
