'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';

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
const short = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(Math.round(v)));
const weekday = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short' });

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

  useEffect(() => {
    if (!allowed) return;
    api<Summary>('/dashboard/summary').then(setData).catch((e) => setError(e.message));
  }, [allowed]);

  if (!user) return null;
  if (!allowed) return <Welcome name={user.username} canSell={can(user, 'SALE_CREATE')} />;

  const todayLabel = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const max = data ? Math.max(...data.trend.map((t) => Number(t.sales)), 1) : 1;

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
              <div className="card-head"><h2>Sales, last 7 days</h2><span className="muted">Rs {n(data.trend.reduce((s, t) => s + Number(t.sales), 0))} total</span></div>
              <div className="bars">
                {data.trend.map((t, i) => (
                  <div key={t.date} className={`bar-col${i === data.trend.length - 1 ? ' today' : ''}`} title={`${t.date}: Rs ${n(t.sales)} · ${t.bills} bills`}>
                    <span className="bar-val">{Number(t.sales) ? short(Number(t.sales)) : ''}</span>
                    <div className="bar" style={{ height: `${(Number(t.sales) / max) * 100}%` }} />
                    <span className="bar-day">{weekday(t.date)}</span>
                  </div>
                ))}
              </div>
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
            <Stat label="Damaged stock" value={String(data.damagedProducts)} sub="products awaiting write-off / return" icon="alert" tone={data.damagedProducts ? 'amber' : ''} />
          </div>

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
              ) : <div className="empty">No bills yet. Create the first one.</div>}
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
