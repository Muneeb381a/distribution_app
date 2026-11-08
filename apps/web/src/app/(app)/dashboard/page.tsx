'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Avatar } from '@/components/Avatar';
import StackedColumns, { LINE_SERIES, type Point } from '@/components/Chart';
import { LineBadge } from '@/components/Badge';
import { Icon, type IconName } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { productLabel } from '@/lib/lookups';
import { lineLabel, localDay, methodLabel, rupees } from '@dist/shared';

interface ProfitRow { period: string; lines: Record<'BOTTLES' | 'RICE', { netSales: string }> }
interface StockRow { productId: string; productName: string; size: string | null; line: string; baseUnit: string; units: { unitName: string; factorToBase: string }[]; locationId: string; locationName: string; ok: string; damaged: string }
interface Collections { rows: { byMethod: Record<string, string>; total: string; count: number }[] }

interface TeamToday { people: { key: string; name: string; avatar: string | null; roleName: string | null; bills: number; sales: string; collected: string; udhaar: string }[] }

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

interface Summary {
  today: { bills: number; netSales: string; cashWithBills: string; receipts: string; udhaar: string; expenses: string; grossProfit: string; netProfit: string; bottles: string; rice: string; bottlesProfit: string; riceProfit: string };
  month: { bills: number; netSales: string; expenses: string; grossProfit: string; netProfit: string; bottles: string; rice: string; bottlesProfit: string; riceProfit: string };
  trend: { date: string; sales: string; bills: number }[];
  khata: { receivable: string; customersOwing: number; overLimit: number; topDebtors: { id: string; name: string; shopName: string | null; area: string | null; balance: string; overLimit: boolean }[] };
  payable: string;
  damagedProducts: number;
  /** Products at or below their own reorder level (all locations together). */
  lowStock: { productId: string; name: string; size: string | null; baseUnit: string; units: { unitName: string; factorToBase: string }[]; reorderLevel: string; onHand: string; where: { name: string; qtyBase: string }[] }[];
  lowStockCount: number;
  chequesDue: { count: number; amount: string };
  recentSales: { id: string; billNo: string; date: string; net: string; paidNow: string; businessLine: string; customer: string | null }[];
}

const n = (v: string | number) => Number(v);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** A small area line of a few values; takes its colour from the parent (currentColor). */
function Spark({ values, height = 46 }: { values: number[]; height?: number }) {
  const w = 220;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, height - 6 - (v / max) * (height - 14)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="dx-spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${line} L${w} ${height} L0 ${height} Z`} className="dx-spark-area" />
      <path d={line} className="dx-spark-line" />
      <circle cx={lx} cy={ly} r="3.5" className="dx-spark-dot" />
    </svg>
  );
}

/** "12% more than yesterday" style change badge. */
function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  if (before <= 0 && now <= 0) return <span className="dx-delta flat">No sales yet {label}</span>;
  if (before <= 0) return <span className="dx-delta up"><Icon name="trend" />New {label}</span>;
  const change = Math.round(((now - before) / before) * 100);
  return (
    <span className={`dx-delta ${change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}`}>
      <Icon name="trend" />{change === 0 ? `Same as ${label}` : `${Math.abs(change)}% ${change > 0 ? 'more' : 'less'} than ${label}`}
    </span>
  );
}

function Donut({ parts, size = 132 }: { parts: { label: string; value: number; color: string }[]; size?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 46;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg className="dx-donut" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value, total)}%`).join(', ')}>
      <circle cx="60" cy="60" r={r} className="dx-donut-track" />
      {total > 0 && parts.map((p) => {
        const len = (p.value / total) * c;
        const seg = <circle key={p.label} cx="60" cy="60" r={r} stroke={p.color} strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`} strokeDashoffset={-offset} className="dx-donut-seg" />;
        offset += len;
        return seg;
      })}
    </svg>
  );
}

function CardTitle({ icon, title, to, linkLabel }: { icon: IconName; title: string; to?: string; linkLabel?: string }) {
  return (
    <div className="dx-title">
      <span className="dx-title-icon"><Icon name={icon} /></span>
      <h2>{title}</h2>
      {to && <Link href={to} className="dx-title-link">{linkLabel ?? 'View all'}<Icon name="chevronRight" /></Link>}
    </div>
  );
}

function Kpi({ icon, tone, label, value, sub, to, bar, children }: { icon: IconName; tone?: 'green' | 'red' | 'amber'; label: string; value: ReactNode; sub?: ReactNode; to?: string; bar?: number; children?: ReactNode }) {
  const body = (
    <>
      <span className="dx-kpi-top"><span className={`dx-kpi-icon${tone ? ` ${tone}` : ''}`}><Icon name={icon} /></span><span className="dx-kpi-label">{label}</span></span>
      <span className="dx-kpi-value">{value}</span>
      {bar !== undefined && <span className="meter dx-kpi-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} /></span>}
      {sub && <span className="dx-kpi-sub">{sub}</span>}
      {children}
    </>
  );
  return to ? <Link href={to} className="card dx-kpi dx-kpi-link">{body}</Link> : <div className="card dx-kpi">{body}</div>;
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
  const [team, setTeam] = useState<TeamToday | null>(null);
  const [backupAge, setBackupAge] = useState<number | null | undefined>(undefined);
  const [dayClosed, setDayClosed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (!allowed) return;
    api<Summary>('/dashboard/summary').then(setData).catch((e) => setError(e.message));
    const t = new Date();
    const first = localDay(new Date(t.getFullYear(), t.getMonth(), 1));
    api<{ rows: ProfitRow[] }>(`/reports/profit?from=${first}&to=${localDay(t)}&groupBy=day`).then((r) => setMonth(r.rows)).catch(() => setMonth([]));
    api<Collections>(`/reports/collections?from=${localDay(t)}&to=${localDay(t)}`).then(setCollections).catch(() => setCollections({ rows: [] }));
    api<StockRow[]>('/stock').then(setStock).catch(() => setStock([]));
    if (can(user, 'SETTINGS_EDIT')) api<{ ageHours: number | null }>('/backups/status').then((b) => setBackupAge(b.ageHours)).catch(() => {});
    if (can(user, 'PAYMENT_RECORD')) api<{ closed: unknown }>(`/day-end?date=${localDay(t)}`).then((d) => setDayClosed(!!d.closed)).catch(() => {});
    api<TeamToday>(`/reports/team?from=${localDay(t)}&to=${localDay(t)}`).then(setTeam).catch(() => setTeam({ people: [] }));
  }, [allowed, user]);

  const monthChart = useMemo<Point[]>(() => {
    if (!month) return [];
    const t = new Date();
    const by = new Map(month.map((r) => [r.period, r]));
    return Array.from({ length: t.getDate() }, (_, i) => {
      const d = new Date(t.getFullYear(), t.getMonth(), i + 1);
      const r = by.get(localDay(d));
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

  if (!user) return null;
  if (!allowed) return <Welcome name={user.displayName || user.username} canSell={can(user, 'SALE_CREATE')} />;

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const first = (user.displayName || user.username).split(' ')[0];

  const trend = data?.trend ?? [];
  const sparkValues = trend.map((t) => n(t.sales));
  const todaySales = data ? n(data.today.netSales) : 0;
  const yesterdaySales = trend.length > 1 ? n(trend[trend.length - 2].sales) : 0;
  const monthSales = data ? n(data.month.netSales) : 0;
  const monthProfit = data ? n(data.month.netProfit) : 0;
  const monthDays = monthChart.filter((d) => d.values.BOTTLES + d.values.RICE > 0);
  const best = monthDays.reduce<Point | null>((b, d) => (!b || d.values.BOTTLES + d.values.RICE > b.values.BOTTLES + b.values.RICE ? d : b), null);
  const avgDay = monthChart.length ? monthSales / monthChart.length : 0;
  const receivable = data ? n(data.khata.receivable) : 0;
  const payable = data ? n(data.payable) : 0;
  const cash = data ? n(data.today.cashWithBills) + n(data.today.receipts) : 0;
  const bottlesShare = data ? n(data.month.bottles) : 0;
  const riceShare = data ? n(data.month.rice) : 0;
  const low = data?.lowStock ?? [];

  const attention: { icon: IconName; tone: 'red' | 'amber'; title: string; sub: string; to: string }[] = [];
  if (data) {
    if (data.khata.overLimit > 0) attention.push({ icon: 'alert', tone: 'red', title: `${data.khata.overLimit} customer${data.khata.overLimit === 1 ? '' : 's'} over their credit limit`, sub: 'Collect before giving more udhaar', to: '/khata' });
    if (data.chequesDue.count > 0) attention.push({ icon: 'wallet', tone: 'amber', title: `${data.chequesDue.count} cheque${data.chequesDue.count === 1 ? '' : 's'} to deposit`, sub: `Rs ${rupees(data.chequesDue.amount)}, dated today or earlier`, to: '/cheques' });
    if (data.lowStockCount > 0) attention.push({ icon: 'stock', tone: 'amber', title: `${data.lowStockCount} product${data.lowStockCount === 1 ? '' : 's'} to reorder`, sub: low.slice(0, 2).map((p) => productLabel(p)).join(', ') + (data.lowStockCount > 2 ? '…' : ''), to: '/stock?low=1' });
    if (backupAge === null || (backupAge !== undefined && backupAge > 48)) attention.push({ icon: 'cloud', tone: 'red', title: backupAge === null ? 'No backup has been taken yet' : `No backup for ${Math.round(backupAge / 24)} days`, sub: 'Your data is only on this computer. Back up now.', to: '/settings?tab=backup' });
    if (dayClosed === false && hour >= 18) attention.push({ icon: 'wallet', tone: 'amber', title: 'Today has not been closed yet', sub: 'Count the cash and close the day', to: '/day-end' });
    if (damaged.length > 0) attention.push({ icon: 'ban', tone: 'red', title: `${damaged.length} damaged stock line${damaged.length === 1 ? '' : 's'}`, sub: damaged.slice(0, 2).map((r) => productLabel({ name: r.productName, size: r.size })).join(', '), to: '/stock' });
  }

  return (
    <div className="dx">
      {error && <p className="error">{error}</p>}

      <section className="dx-hero">
        <div className="dx-hero-main">
          <div className="dx-hero-hello">
            <Avatar user={user} size={46} className="dx-hero-pic" />
            <div><p>{greeting}, {first}</p><span>{todayLabel}</span></div>
          </div>
          <div className="dx-hero-big">
            <span className="dx-hero-label">Sales today</span>
            <b>{data ? <><small>Rs</small>{rupees(data.today.netSales)}</> : <span className="skeleton" style={{ display: 'inline-block', width: 200, height: 44 }} />}</b>
            {data && <Delta now={todaySales} before={yesterdaySales} label="yesterday" />}
          </div>
          <div className="dx-hero-actions">
            {can(user, 'SALE_CREATE') && <Link href="/sales/new" className="dx-act lead"><Icon name="plus" />New bill</Link>}
            {can(user, 'PAYMENT_RECORD') && <Link href="/khata" className="dx-act"><Icon name="khata" />Receive payment</Link>}
            {can(user, 'EXPENSE_MANAGE') && <Link href="/expenses" className="dx-act"><Icon name="expenses" />Add expense</Link>}
          </div>
        </div>
        <div className="dx-hero-side">
          <div className="dx-hero-spark">{data ? <Spark values={sparkValues} height={70} /> : null}<span>Last 7 days{data ? ` · Rs ${rupees(trend.reduce((s, t) => s + n(t.sales), 0))}` : ''}</span></div>
          <div className="dx-hero-stats">
            <div><span>Bills</span><b>{data ? data.today.bills : '—'}</b></div>
            <div><span>Cash in</span><b>{data ? rupees(cash) : '—'}</b></div>
            <div><span>Udhaar given</span><b>{data ? rupees(data.today.udhaar) : '—'}</b></div>
            <div><span>Profit</span><b className={data && n(data.today.netProfit) < 0 ? 'neg' : ''}>{data ? rupees(data.today.netProfit) : '—'}</b></div>
          </div>
        </div>
      </section>

      {!data && !error && <div className="dx-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 132 }} />)}</div>}

      {data && (
        <>
          <div className="dx-kpis">
            <Kpi icon="trend" tone={monthProfit < 0 ? 'red' : 'green'} label="Net profit this month" value={<><small>Rs</small>{rupees(monthProfit)}</>} bar={pct(Math.max(0, monthProfit), monthSales)} sub={monthProfit < 0 ? 'Expenses are higher than the profit so far' : `${pct(monthProfit, monthSales)}% margin on Rs ${rupees(monthSales)} sales`} to="/reports" />
            <Kpi icon="customers" tone="amber" label="Customers owe us" value={<><small>Rs</small>{rupees(receivable)}</>} sub={`${data.khata.customersOwing} customer${data.khata.customersOwing === 1 ? '' : 's'}${data.khata.overLimit ? ` · ${data.khata.overLimit} over limit` : ''}`} to="/khata" />
            <Kpi icon="suppliers" tone="red" label="We owe suppliers" value={<><small>Rs</small>{rupees(payable)}</>} sub="open supplier balances" to="/suppliers" />
            <Kpi icon="wallet" tone="green" label="Collected today" value={<><small>Rs</small>{rupees(collectedTotal)}</>} sub={byMethod.length ? byMethod.map(([m, v]) => `${methodLabel(m)} ${rupees(v)}`).join(' · ') : 'No receipts yet today'}>
              {byMethod.length > 0 && <span className="method-bar" aria-hidden="true">{byMethod.map(([m, v], i) => <span key={m} style={{ flex: v, background: SERIES[i % 4] }} />)}</span>}
            </Kpi>
          </div>

          <div className="dx-row dx-row-main">
            <section className="card dx-card">
              <CardTitle icon="reports" title="Sales this month" to="/reports" linkLabel="Reports" />
              <div className="dx-chart-stats">
                <div><span>Month so far</span><b>Rs {rupees(monthSales)}</b></div>
                <div><span>Average a day</span><b>Rs {rupees(Math.round(avgDay))}</b></div>
                <div><span>Best day</span><b>{best ? `${best.label} ${now.toLocaleDateString('en-GB', { month: 'short' })}` : '—'}</b></div>
                <div><span>Bills</span><b>{data.month.bills}</b></div>
              </div>
              {!month ? <span className="skeleton" style={{ display: 'block', height: 250 }} />
                : <StackedColumns data={monthChart} series={LINE_SERIES} caption="Net sales per day this month, bottles and rice" highlight={String(now.getDate())} />}
            </section>

            <section className="card dx-card">
              <CardTitle icon="products" title="Bottles and rice" to="/reports" linkLabel="Reports" />
              <div className="dx-mix">
                <div className="dx-donut-wrap">
                  <Donut parts={[{ label: 'Bottles', value: bottlesShare, color: 'var(--series-1)' }, { label: 'Rice', value: riceShare, color: 'var(--series-2)' }]} />
                  <span className="dx-donut-center"><b>{pct(Math.max(bottlesShare, riceShare), bottlesShare + riceShare)}%</b><span>{bottlesShare >= riceShare ? 'bottles' : 'rice'}</span></span>
                </div>
                <ul className="dx-legend">
                  {[['BOTTLES', 'Bottles', bottlesShare, n(data.month.bottlesProfit), 'var(--series-1)'], ['RICE', 'Rice', riceShare, n(data.month.riceProfit), 'var(--series-2)']].map(([key, , sales, profit, color]) => (
                    <li key={key as string}>
                      <span className="dx-legend-top"><i style={{ background: color as string }} /><LineBadge line={key as string} /><b>Rs {rupees(sales as number)}</b></span>
                      <span className="dx-legend-sub">{pct(sales as number, bottlesShare + riceShare)}% of sales · profit <b className={(profit as number) < 0 ? 'error' : 'ok'}>Rs {rupees(profit as number)}</b></span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="dx-mini-table">
                <div><span>Combined profit</span><b>Rs {rupees(data.month.grossProfit)}</b></div>
                <div><span>Expenses</span><b>Rs {rupees(data.month.expenses)}</b></div>
                <div className="total"><span>Net profit</span><b className={monthProfit < 0 ? 'error' : 'ok'}>Rs {rupees(monthProfit)}</b></div>
              </div>
            </section>
          </div>

          <div className="dx-row dx-row-three">
            <section className="card dx-card">
              <CardTitle icon="alert" title="Needs attention" />
              {attention.length ? (
                <ul className="dx-attn">
                  {attention.map((a) => (
                    <li key={a.to + a.title}>
                      <Link href={a.to}>
                        <span className={`dx-attn-icon ${a.tone}`}><Icon name={a.icon} /></span>
                        <span className="dx-attn-text"><b>{a.title}</b><span>{a.sub}</span></span>
                        <Icon name="chevronRight" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="dx-allgood"><span><Icon name="check" /></span><b>All clear</b><p>No credit, cheque or stock problems right now.</p></div>
              )}
            </section>

            <section className="card dx-card">
              <CardTitle icon="wallet" title="Money position" />
              <div className="dx-position">
                <div className="dx-pos-row">
                  <span className="dx-pos-label"><i className="amber" />To receive from customers</span>
                  <b>Rs {rupees(receivable)}</b>
                  <span className="meter" aria-hidden="true"><span style={{ width: `${pct(receivable, receivable + payable)}%`, background: 'var(--warn)' }} /></span>
                </div>
                <div className="dx-pos-row">
                  <span className="dx-pos-label"><i className="red" />To pay suppliers</span>
                  <b>Rs {rupees(payable)}</b>
                  <span className="meter" aria-hidden="true"><span style={{ width: `${pct(payable, receivable + payable)}%`, background: 'var(--danger)' }} /></span>
                </div>
                <div className="dx-pos-net">
                  <span>Net outstanding</span>
                  <b className={receivable - payable < 0 ? 'error' : 'ok'}>{receivable - payable < 0 ? '−' : ''}Rs {rupees(Math.abs(receivable - payable))}</b>
                  <p>{receivable >= payable ? 'Customers owe you more than you owe suppliers.' : 'You owe suppliers more than customers owe you.'}</p>
                </div>
              </div>
            </section>

            <section className="card dx-card">
              <CardTitle icon="khata" title="Biggest balances" to="/khata" linkLabel="Khata" />
              {data.khata.topDebtors.length ? (
                <ul className="dx-people">
                  {data.khata.topDebtors.slice(0, 5).map((c) => {
                    const top = n(data.khata.topDebtors[0].balance) || 1;
                    return (
                      <li key={c.id}>
                        <Link href={`/khata/${c.id}`} className="dx-person">
                          <Avatar user={{ username: c.name }} size={34} />
                          <span className="dx-person-text"><b>{c.name}</b><span className="meter" aria-hidden="true"><span className={c.overLimit ? 'over' : ''} style={{ width: `${pct(n(c.balance), top)}%`, background: c.overLimit ? 'var(--danger)' : 'var(--warn)' }} /></span></span>
                          <span className="dx-person-amt">Rs {rupees(c.balance)}{c.overLimit && <small>Over limit</small>}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : <div className="empty">Nobody owes anything.</div>}
            </section>
          </div>

          <section className="card dx-card">
            <CardTitle icon="employees" title="Who sold today" to="/team" linkLabel="Team activity" />
            {!team ? <span className="skeleton" style={{ display: 'block', height: 96 }} />
              : team.people.length ? (
                <ul className="dx-team">
                  {team.people.slice(0, 5).map((p) => {
                    const top = Math.max(...team.people.map((x) => n(x.sales)), 1);
                    return (
                      <li key={p.key}>
                        <Avatar user={{ username: p.name, displayName: p.name, avatar: p.avatar }} size={36} />
                        <span className="dx-team-main">
                          <b>{p.name}</b>
                          <span className="meter" aria-hidden="true"><span style={{ width: `${pct(n(p.sales), top)}%` }} /></span>
                        </span>
                        <span className="dx-team-nums"><b>Rs {rupees(p.sales)}</b><span>{p.bills} bill{p.bills === 1 ? '' : 's'} · took Rs {rupees(p.collected)}</span></span>
                      </li>
                    );
                  })}
                </ul>
              ) : <div className="empty">Nobody has made a bill or taken a payment yet today.</div>}
          </section>

          <section className="card dx-card">
            <CardTitle icon="sales" title="Recent bills" to="/sales" />
            {data.recentSales.length ? (
              <div className="table-wrap">
                <table className="dx-table">
                  <thead><tr><th>Bill</th><th>Customer</th><th>Line</th><th className="num">Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.recentSales.map((s) => (
                      <tr key={s.id}>
                        <td><Link className="bill-no" href={`/sales/${s.id}`}>{s.billNo}</Link><span className="dx-date">{s.date.slice(0, 10)}</span></td>
                        <td>{s.customer ? <span className="person"><Avatar user={{ username: s.customer }} size={28} /><b>{s.customer}</b></span> : <span className="muted">Walk-in</span>}</td>
                        <td>{lineLabel(s.businessLine)}</td>
                        <td className="num"><b>Rs {rupees(s.net)}</b></td>
                        <td>{n(s.net) > n(s.paidNow) ? <span className="badge amber">Udhaar {rupees(n(s.net) - n(s.paidNow))}</span> : <span className="badge green">Paid</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No bills yet.{can(user, 'SALE_CREATE') && <> <Link href="/sales/new">Create the first one</Link>.</>}</div>}
          </section>
          <p className="dx-foot muted">Reorder levels are set per product on the Products page. Expenses come off the combined profit, not each line.</p>
        </>
      )}
    </div>
  );
}
