'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { DueBadge, LineBadge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { LoadMore, rowLink, SortTh, usePaged, useSort } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';
import { money, saleTypeLabel } from '@dist/shared';

interface SaleRow {
  id: string; billNo: string; date: string; businessLine: string; saleType: string; net: string; paidNow: string; status: string;
  /** From the khata allocation: paid so far and still owed, null for cash sales and cancelled bills. */
  deliveryStatus: string | null; vehicleName: string | null;
  payStatus: 'PAID' | 'PART' | 'UNPAID' | null; paid: string | null; remaining: string | null;
  customer: { name: string; shopName: string | null } | null; salesman: { name: string } | null;
}


export default function SalesPage() {
  const user = useUser();
  const router = useRouter();
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [line, setLine] = useState('');
  const [pending, setPending] = useState(false);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<SaleRow[]>(`/sales?${[line && `line=${line}`, pending && 'delivery=PENDING'].filter(Boolean).join('&')}`).then((r) => { setRows(r); setLoaded(true); }).catch((e) => setError(e.message));
  }, [line, pending]);

  const shown = useMemo(() => {
    const f = text.trim().toLowerCase();
    return f ? rows.filter((r) => `${r.billNo} ${r.customer?.name ?? 'cash sale'} ${r.customer?.shopName ?? ''} ${r.salesman?.name ?? ''}`.toLowerCase().includes(f)) : rows;
  }, [rows, text]);

  type Key = 'bill' | 'date' | 'customer' | 'total' | 'paid';
  const { sorted, sort, toggle } = useSort<SaleRow, Key>(shown, (r, k) =>
    k === 'bill' ? r.billNo : k === 'date' ? r.date : k === 'customer' ? (r.customer?.name ?? '') : k === 'total' ? r.net : (r.paid ?? r.paidNow));
  const { page, loadMore, reset } = usePaged(sorted, 30);
  const active = shown.filter((r) => r.status !== 'CANCELLED');
  const total = active.reduce((s, r) => s + Number(r.net), 0);
  const paidOf = (r: SaleRow) => Number(r.paid ?? r.paidNow);
  const paid = active.reduce((s, r) => s + paidOf(r), 0);
  const udhaar = active.reduce((s, r) => s + (r.remaining != null ? Number(r.remaining) : Math.max(0, Number(r.net) - Number(r.paidNow))), 0);

  return (
    <>
      <div className="page-head">
        <div><h1>Sales</h1><p>{loaded ? `${rows.length} bills` : 'Loading…'}</p></div>
        {can(user, 'SALE_CREATE') && <Link href="/sales/new" className="btn primary"><Icon name="plus" />New bill</Link>}
      </div>
      {error && <p className="error">{error}</p>}

      <div className="sum-bar">
        <div><span>Total sales</span><b>Rs {money(total)}</b></div>
        <div><span>Paid</span><b>Rs {money(paid)}</b></div>
        <div><span>Udhaar</span><b>Rs {money(udhaar)}</b></div>
        <div><span>Bills</span><b>{active.length}</b></div>
      </div>

      <div className="list-head">
        <div className="filter"><Icon name="search" /><input aria-label="Search bills" placeholder="Search bill no, customer, salesman…" value={text} onChange={(e) => { setText(e.target.value); reset(); }} /></div>
        {[['', 'All'], ['BOTTLES', 'Bottles'], ['RICE', 'Rice']].map(([v, l]) => (
          <button key={v} className={`chip${line === v ? ' on' : ''}`} onClick={() => setLine(v)}>{l}</button>
        ))}
        <button className={`chip${pending ? ' on' : ''}`} aria-pressed={pending} onClick={() => setPending(!pending)}><Icon name="file" />Not delivered yet</button>
      </div>

      <table className="sticky-head">
        <thead>
          <tr>
            <SortTh k="bill" sort={sort} toggle={toggle}>Bill</SortTh>
            <SortTh k="date" sort={sort} toggle={toggle}>Date</SortTh>
            <SortTh k="customer" sort={sort} toggle={toggle}>Customer</SortTh>
            <th>Line</th><th>Type</th><th>Salesman</th>
            <SortTh k="total" sort={sort} toggle={toggle} num>Total</SortTh>
            <SortTh k="paid" sort={sort} toggle={toggle} num>Paid</SortTh>
            <th className="num">Left</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {!loaded && !error && <SkeletonRows cols={10} />}
          {page.map((r) => {
            return (
              <tr key={r.id} {...rowLink(() => router.push(`/sales/${r.id}`))} style={r.status === 'CANCELLED' ? { opacity: 0.55 } : undefined}>
                <td><Link href={`/sales/${r.id}`}>{r.billNo}</Link></td>
                <td>{r.date.slice(0, 10)}</td>
                <td>{r.customer?.name ?? <span className="muted">Cash sale</span>}{r.customer?.shopName && <span className="muted"> · {r.customer.shopName}</span>}</td>
                <td><LineBadge line={r.businessLine} /></td>
                <td>{saleTypeLabel(r.saleType)}</td>
                <td>{r.salesman?.name ?? ''}</td>
                <td className="num"><strong>{money(r.net)}</strong></td>
                <td className="num">{money(r.paid ?? r.paidNow)}</td>
                <td className="num">{r.status !== 'CANCELLED' && Number(r.remaining ?? 0) > 0 ? <strong>{money(r.remaining ?? 0)}</strong> : ''}</td>
                <td>
                  {r.deliveryStatus === 'PENDING' && <span className="badge blue" style={{ marginRight: 6 }}>{r.vehicleName ? `On ${r.vehicleName}` : 'Not delivered'}</span>}
                  {r.payStatus === 'PART' ? <span className="badge amber">Part paid · left {money(r.remaining ?? 0)}</span>
                    : <DueBadge status={r.status} total={r.net} paid={r.paid ?? r.paidNow} />}
                </td>
              </tr>
            );
          })}
          {loaded && !shown.length && (
            <tr><td colSpan={10}>
              {text ? <Empty icon="search" title={`No bills match “${text}”`} text="Try a bill number or customer name." />
                : <Empty icon="sales" title="No bills yet" text="Bills you make show up here." action={can(user, 'SALE_CREATE') && <Link className="btn primary" href="/sales/new"><Icon name="plus" />Create first bill</Link>} />}
            </td></tr>
          )}
        </tbody>
      </table>
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />
    </>
  );
}
