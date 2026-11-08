'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { StatTiles } from '@/components/StatTiles';
import { DueBadge, LineBadge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { LoadMore, rowLink, SortTh, usePaged, useSort } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';
import { formatDate, money, saleTypeLabel } from '@dist/shared';

interface SaleRow {
  id: string; billNo: string; date: string; businessLine: string; saleType: string; net: string; paidNow: string; status: string;
  /** From the khata allocation: paid so far and still owed, null for cash sales and cancelled bills. */
  deliveryStatus: string | null; vehicleName: string | null; proofCount: number;
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

      <StatTiles items={[
        { label: 'Total sales', value: <><small>Rs</small>{money(total)}</>, sub: 'all bills shown, cancelled left out', icon: 'sales' },
        { label: 'Paid', value: <><small>Rs</small>{money(paid)}</>, sub: total ? `${Math.round((paid / total) * 100)}% collected` : undefined, icon: 'wallet', tone: 'green' },
        { label: 'Udhaar', value: <><small>Rs</small>{money(udhaar)}</>, sub: udhaar ? 'still to collect' : 'nothing owed', icon: 'khata', tone: udhaar ? 'amber' : 'green' },
        { label: 'Bills', value: active.length, sub: rows.length !== active.length ? `${rows.length - active.length} cancelled` : undefined, icon: 'file' },
      ]} />

      <div className="list-head">
        <div className="filter"><Icon name="search" /><input aria-label="Search bills" placeholder="Search bill, customer, salesman…" value={text} onChange={(e) => { setText(e.target.value); reset(); }} /></div>
        <div className="chips">
          {[['', 'All'], ['BOTTLES', 'Bottles'], ['RICE', 'Rice']].map(([v, l]) => (
            <button key={v} type="button" className={`chip${line === v ? ' on' : ''}`} aria-pressed={line === v} onClick={() => setLine(v)}>{l}</button>
          ))}
          <button type="button" className={`chip${pending ? ' on' : ''}`} data-tone="amber" aria-pressed={pending} onClick={() => setPending(!pending)}><Icon name="suppliers" />Not delivered yet</button>
        </div>
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
                <td><Link className="bill-no" href={`/sales/${r.id}`}>{r.billNo}</Link></td>
                <td className="nowrap">{formatDate(r.date, 'short')}</td>
                <td>
                  <span className="person">
                    <Avatar user={{ username: r.customer?.name ?? 'Cash sale' }} size={30} />
                    <span className="person-text">
                      <b>{r.customer?.name ?? 'Cash sale'}</b>
                      {r.customer?.shopName && <span>{r.customer.shopName}</span>}
                    </span>
                  </span>
                </td>
                <td><LineBadge line={r.businessLine} /></td>
                <td><span className={`badge${r.saleType === 'DELIVERY' ? ' blue' : ''}`}>{saleTypeLabel(r.saleType)}</span></td>
                <td className="muted">{r.salesman?.name ?? '—'}</td>
                <td className="num"><strong>{money(r.net)}</strong></td>
                <td className="num">{money(r.paid ?? r.paidNow)}</td>
                <td className="num">{r.status !== 'CANCELLED' && Number(r.remaining ?? 0) > 0 ? <strong className="left-amt">{money(r.remaining ?? 0)}</strong> : <span className="muted">—</span>}</td>
                <td>
                  {r.deliveryStatus === 'PENDING' && <span className="badge blue" style={{ marginRight: 6 }}>{r.vehicleName ? `On ${r.vehicleName}` : 'Not delivered'}</span>}
                  {r.saleType === 'DELIVERY' && r.status !== 'CANCELLED' && (r.proofCount > 0 ? <span className="badge teal" style={{ marginRight: 6 }} title="Photo of the signed slip is saved"><Icon name="camera" />{r.proofCount}</span> : r.deliveryStatus === 'DELIVERED' ? <span className="badge amber" style={{ marginRight: 6 }} title="Delivered, but no photo of the signed slip">no photo</span> : null)}
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
