'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { LoadMore, rowLink, SortTh, usePaged, useSort } from '@/components/Table';
import { api } from '@/lib/api';

interface Row {
  id: string; name: string; shopName: string | null; area: string | null; phone: string | null;
  type: string; creditLimit: string | null; balance: string; overLimit: boolean;
}

const n = (v: string | number) => Number(v).toLocaleString();

export default function KhataPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [onlyOwing, setOnlyOwing] = useState(true);
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Row[]>('/khata/balances').then((r) => { setRows(r); setLoaded(true); }).catch((e) => setError(e.message));
  }, []);

  const shown = rows.filter(
    (r) => (!onlyOwing || Number(r.balance) !== 0) && `${r.name} ${r.shopName ?? ''} ${r.area ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const total = shown.reduce((s, r) => s + Number(r.balance), 0);
  const over = shown.filter((r) => r.overLimit).length;
  type Key = 'name' | 'area' | 'limit' | 'balance';
  const { sorted, sort, toggle } = useSort<Row, Key>(shown, (r, k) => (k === 'name' ? r.name : k === 'area' ? r.area : k === 'limit' ? r.creditLimit : r.balance), { key: 'balance', dir: 'desc' });
  const { page, loadMore } = usePaged(sorted, 30);

  return (
    <>
      <div className="page-head"><div><h1>Khata</h1><p>Outstanding customer balances</p></div></div>
      {error && <p className="error">{error}</p>}

      <div className="sum-bar">
        <div><span>Total outstanding</span><b>Rs {n(total)}</b></div>
        <div><span>Customers</span><b>{shown.length}</b></div>
        <div><span>Over limit</span><b className={over ? 'error' : ''}>{over}</b></div>
      </div>

      <div className="list-head">
        <div className="filter"><Icon name="search" /><input aria-label="Search customers" placeholder="Search name, shop, area, phone…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <button className={`chip${onlyOwing ? ' on' : ''}`} onClick={() => setOnlyOwing(true)}>With balance</button>
        <button className={`chip${!onlyOwing ? ' on' : ''}`} onClick={() => setOnlyOwing(false)}>All customers</button>
      </div>

      <table className="sticky-head">
        <thead>
          <tr>
            <SortTh k="name" sort={sort} toggle={toggle}>Customer</SortTh>
            <SortTh k="area" sort={sort} toggle={toggle}>Area</SortTh>
            <th>Phone</th>
            <SortTh k="limit" sort={sort} toggle={toggle} num>Limit</SortTh>
            <SortTh k="balance" sort={sort} toggle={toggle} num>Balance</SortTh>
            <th>Status</th><th />
          </tr>
        </thead>
        <tbody>
          {!loaded && !error && <SkeletonRows cols={7} />}
          {page.map((r) => (
            <tr key={r.id} {...rowLink(() => router.push(`/khata/${r.id}`))}>
              <td><strong>{r.name}</strong>{r.shopName && <span className="muted"> · {r.shopName}</span>}</td>
              <td>{r.area}</td>
              <td>{r.phone}</td>
              <td className="num">{r.creditLimit ? n(r.creditLimit) : '—'}</td>
              <td className="num"><strong className={r.overLimit ? 'error' : ''}>{n(r.balance)}</strong></td>
              <td>{r.overLimit ? <span className="badge red">Over limit</span> : Number(r.balance) > 0 ? <span className="badge amber">Owes</span> : Number(r.balance) < 0 ? <span className="badge blue">Advance</span> : <span className="badge green">Clear</span>}</td>
              <td><Link href={`/khata/${r.id}`}>Open →</Link></td>
            </tr>
          ))}
          {loaded && !shown.length && (
            <tr><td colSpan={7}><Empty icon="khata" title={search ? `No customer matches “${search}”` : 'Nothing outstanding'} text={onlyOwing && !search ? 'Every customer is clear.' : undefined} action={onlyOwing && <button type="button" className="secondary" onClick={() => setOnlyOwing(false)}>Show all customers</button>} /></td></tr>
          )}
        </tbody>
      </table>
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />
    </>
  );
}
