'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import StackedColumns, { LINE_SERIES, type Point } from '@/components/Chart';
import { Icon, type IconName } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { formatQty, productLabel } from '@/lib/lookups';

interface ProfitRow { period: string; lines: Record<'BOTTLES' | 'RICE', { netSales: string }> }
interface StockRow { productId: string; productName: string; size: string | null; line: string; baseUnit: string; units: { unitName: string; factorToBase: string }[]; locationId: string; locationName: string; ok: string; damaged: string }
interface Collections { rows: { byMethod: Record<string, string>; total: string; count: number }[] }

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', BANK: 'Bank', EASYPAISA: 'Easypaisa', JAZZCASH: 'JazzCash' };
/** Low stock: under 5 cartons for bottles, under 100 kg for rice. */
function isLow(r: StockRow) {
  const q = Number(r.ok);
  if (r.baseUnit === 'BOTTLE') {
    const f = Number(r.units.find((u) => u.unitName === 'CARTON')?.factorToBase ?? 1);
    return q < 5 * f;
  }
  return q < 100;
}

interface Summary {
  today: { bills: number; netSales: string; cashWithBills: string; receipts: string; udhaar: string; expenses: string; grossProfit: string; netProfit: string };
  month: { bills: number; netSales: string; expenses: string; grossProfit: string; netProfit: string; bottles: string; rice: string };
  trend: { date: string; sales: string; bills: number }[];
  khata: { receivable: string; customersOwing: number; overLimit: number; topDebtors: { id: string; name: string; shopName: string | null; area: string | null; balance: string; overLimit: boolean }[] };
  payable: string;
  damagedProducts: number;
  recentSales: { id: string; billNo: string; date: string; net: string; paidNow: string; businessLine: string; customer: string | null }[];
}

const n = (v: string | number) => Math.round(Number(v)).toLocaleString();

function Stat({ label, value, sub, icon, tone = '', negative = false }: { label: string; value: string; sub?: string; icon: IconName; tone?: string; negative?: boolean }) {
  return (
    <div className="stat">
      <div className="label"><span className={`icon ${tone}`}><Icon name={icon} /></span>{label}</div>
      <div className={`value${negative ? ' neg' : ''}`}><small>Rs</small>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Welcome({ name, canSell }: { name: string; canSell: boolean }) {
  return (
    <>
      <div className="page-head"><div><h1>Welcome, {name}</h1><p>Pick up where you left off.</p></div></div>
      <div className="quick">
        {canSell && <Link href="/sales/new" className="primary"><Icon name="plus" />New bill</Link>}
        <Link href="/customers"><Icon name="customers" />Customers</Link>
        <Link href="/stock"><Icon name="stock" />Stock</Link>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const user = useUser();
  const allowed = can(user, 'REPORT_VIEW');
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [month, setMonth] = useState<ProfitRow[] | null>(null);
  const [stock, setStock] = useState<StockRow[] | null>(null);
  const [collections, setCollections] = useState<Collections | null>(null);

  useEffect(() => {
    if (!allowed) return;
    api<Summary>('/dashboard/summary').then(setData).catch((e) => setError(e.message));
    const t = new Date();
    const first = iso(new Date(t.getFullYear(), t.getMonth(), 1));
    api<{ rows: ProfitRow[] }>(`/reports/profit?from=${first}&to=${iso(t)}&groupBy=day`).then((r) => setMonth(r.rows)).catch(() => setMonth([]));
    api<Collections>(`/reports/collections?from=${iso(t)}&to=${iso(t)}`).then(setCollections).catch(() => setCollections({ rows: [] }));
    api<StockRow[]>('/stock').then(setStock).catch(() => setStock([]));
  }, [allowed]);

  const monthChart = useMemo<Point[]>(() => {
    if (!month) return [];
    const t = new Date();
    const by = new Map(month.map((r) => [r.period, r]));
    return Array.from({ length: t.getDate() }, (_, i) => {
      const d = new Date(t.getFullYear(), t.getMonth(), i + 1);
      const r = by.get(iso(d));
      return {
        label: String(i + 1),
        title: d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
        values: { BOTTLES: r ? Number(r.lines.BOTTLES.netSales) : 0, RICE: r ? Number(r.lines.RICE.netSales) : 0 },
      };
    });
  }, [month]);

  const byMethod = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of collections?.rows ?? []) for (const [k, v] of Object.entries(r.byMethod)) m[k] = (m[k] ?? 0) + Number(v);
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [collections]);
  const collectedTotal = byMethod.reduce((s, [, v]) => s + v, 0);
  const damaged = (stock ?? []).filter((r) => Number(r.damaged) > 0);
  const low = (stock ?? []).filter(isLow).sort((a, b) => Number(a.ok) - Number(b.ok));

  if (!user) return null;
  if (!allowed) return <Welcome name={user.username} canSell={can(user, 'SALE_CREATE')} />;

  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><p>{todayLabel}</p></div>
        <div className="quick">
          {can(user, 'SALE_CREATE') && <Link href="/sales/new" className="primary"><Icon name="plus" />New bill</Link>}
          {can(user, 'PAYMENT_RECORD') && <Link href="/khata"><Icon name="khata" />Receive payment</Link>}
          {can(user, 'EXPENSE_MANAGE') && <Link href="/expenses"><Icon name="expenses" />Add expense</Link>}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!data && !error && (
        <div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}</div>
      )}

      {data && (
        <>
          <div className="stats">
            <Stat label="Sales today" value={n(data.today.netSales)} sub={`${data.today.bills} bill${data.today.bills === 1 ? '' : 's'}`} icon="sales" />
            <Stat label="Cash received" value={n(Number(data.today.cashWithBills) + Number(data.today.receipts))} sub={`${n(data.today.receipts)} from old khata`} icon="wallet" tone="green" />
            <Stat label="Udhaar given today" value={n(data.today.udhaar)} sub="unpaid part of today's bills" icon="khata" tone="amber" />
            <Stat label="Profit today" value={n(data.today.netProfit)} sub={`after ${n(data.today.expenses)} expenses`} icon="trend" tone={Number(data.today.netProfit) < 0 ? 'red' : 'green'} negative={Number(data.today.netProfit) < 0} />
          </div>

          <div className="dash-grid">
            <div className="card">
              <div className="card-head"><h2>Sales this month</h2><Link href="/reports">Reports</Link></div>
              {!month ? <span className="skeleton" style={{ display: 'block', height: 250 }} />
                : <StackedColumns data={monthChart} series={LINE_SERIES} caption="Net sales per day this month, bottles and rice" highlight={String(new Date().getDate())} />}
              <p className="muted chart-note">Last 7 days: Rs {n(data.trend.reduce((s, t) => s + Number(t.sales), 0))} · {data.trend.reduce((s, t) => s + t.bills, 0)} bills</p>
            </div>

            <div className="card">
              <div className="card-head"><h2>This month</h2></div>
              <ul className="list">
                <li><span className="muted">Net sales</span><span className="amt">Rs {n(data.month.netSales)}</span></li>
                <li><span className="muted">· Bottles</span><span className="amt">Rs {n(data.month.bottles)}</span></li>
                <li><span className="muted">· Rice</span><span className="amt">Rs {n(data.month.rice)}</span></li>
                <li><span className="muted">Gross profit</span><span className="amt">Rs {n(data.month.grossProfit)}</span></li>
                <li><span className="muted">Expenses</span><span className="amt">Rs {n(data.month.expenses)}</span></li>
                <li><strong>Net profit</strong><span className={`amt ${Number(data.month.netProfit) < 0 ? 'error' : 'ok'}`}>Rs {n(data.month.netProfit)}</span></li>
              </ul>
            </div>
          </div>

          <div className="stats" style={{ marginTop: 20 }}>
            <Stat label="Customers owe us" value={n(data.khata.receivable)} sub={`${data.khata.customersOwing} customers${data.khata.overLimit ? ` · ${data.khata.overLimit} over limit` : ''}`} icon="customers" tone="amber" />
            <Stat label="We owe suppliers" value={n(data.payable)} sub="open supplier balances" icon="suppliers" tone="red" />
            <div className="stat">
              <div className="label"><span className="icon green"><Icon name="wallet" /></span>Collected today</div>
              <div className="value"><small>Rs</small>{n(collectedTotal)}</div>
              <div className="method-bar" aria-hidden="true">
                {byMethod.map(([m, v], i) => <span key={m} style={{ flex: v, background: SERIES[i % 4] }} />)}
              </div>
              <div className="sub method-list">
                {byMethod.length ? byMethod.map(([m, v], i) => <span key={m}><i style={{ background: SERIES[i % 4] }} />{METHOD_LABEL[m] ?? m} {n(v)}</span>) : 'No receipts yet today'}
              </div>
            </div>
          </div>

          {stock && (low.length > 0 || damaged.length > 0) && (
            <div className="card alert-card">
              <div className="card-head">
                <h2><Icon name="alert" /> Stock needs attention</h2>
                <Link href="/stock">Open stock</Link>
              </div>
              <div className="alert-cols">
                <div>
                  <h3>Low stock <span className="badge amber">{low.length}</span></h3>
                  <ul className="list">
                    {low.slice(0, 5).map((r) => (
                      <li key={`${r.productId}|${r.locationId}`}>
                        <span className="who-line"><b>{productLabel({ name: r.productName, size: r.size })}</b><span>{r.locationName}</span></span>
                        <span className={`amt${Number(r.ok) <= 0 ? ' error' : ''}`}>{formatQty(r.ok, r.units, r.baseUnit)}</span>
                      </li>
                    ))}
                    {!low.length && <li className="muted">Nothing is running low.</li>}
                  </ul>
                  {low.length > 5 && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>+{low.length - 5} more</p>}
                </div>
                <div>
                  <h3>Damaged stock <span className="badge red">{damaged.length}</span></h3>
                  <ul className="list">
                    {damaged.slice(0, 5).map((r) => (
                      <li key={`${r.productId}|${r.locationId}`}>
                        <span className="who-line"><b>{productLabel({ name: r.productName, size: r.size })}</b><span>{r.locationName}</span></span>
                        <span className="amt">{formatQty(r.damaged, r.units, r.baseUnit)}</span>
                      </li>
                    ))}
                    {!damaged.length && <li className="muted">No damaged stock waiting.</li>}
                  </ul>
                </div>
              </div>
              <p className="muted" style={{ margin: '12px 0 0', fontSize: 12.5 }}>Low = under 5 cartons (bottles) or 100 kg (rice) at a location.</p>
            </div>
          )}

          <div className="dash-grid">
            <div className="card">
              <div className="card-head"><h2>Recent bills</h2><Link href="/sales">View all</Link></div>
              {data.recentSales.length ? (
                <ul className="list">
                  {data.recentSales.map((s) => (
                    <li key={s.id}>
                      <div className="who-line">
                        <b><Link href={`/sales/${s.id}`}>{s.billNo}</Link></b>
                        <span>{s.customer ?? 'Walk-in'} · {s.date.slice(0, 10)} · {s.businessLine === 'RICE' ? 'Rice' : 'Bottles'}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="amt">Rs {n(s.net)}</div>
                        {Number(s.net) > Number(s.paidNow) ? <span className="badge amber">Udhaar {n(Number(s.net) - Number(s.paidNow))}</span> : <span className="badge green">Paid</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <div className="empty">No bills yet.{can(user, 'SALE_CREATE') && <> <Link href="/sales/new">Create the first one</Link>.</>}</div>}
            </div>

            <div className="card">
              <div className="card-head"><h2>Biggest balances</h2><Link href="/khata">Khata</Link></div>
              {data.khata.topDebtors.length ? (
                <ul className="list">
                  {data.khata.topDebtors.map((c) => (
                    <li key={c.id}>
                      <div className="who-line">
                        <b><Link href={`/khata/${c.id}`}>{c.name}</Link></b>
                        <span>{[c.shopName, c.area].filter(Boolean).join(' · ') || '—'}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="amt">Rs {n(c.balance)}</div>
                        {c.overLimit && <span className="badge red">Over limit</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <div className="empty">Nobody owes anything.</div>}
            </div>
          </div>
        </>
      )}
    </>
  );
}
