'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { StatTiles } from '@/components/StatTiles';
import { Icon } from '@/components/Icon';
import { LoadMore, rowLink, SortTh, usePaged, useSort } from '@/components/Table';
import { api } from '@/lib/api';
import { money } from '@dist/shared';

interface Row {
  id: string; name: string; shopName: string | null; area: string | null; phone: string | null;
  type: string; creditLimit: string | null; balance: string; overLimit: boolean;
}


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
  const owing = rows.filter((r) => Number(r.balance) > 0);
  const biggest = [...shown].sort((a, b) => Number(b.balance) - Number(a.balance))[0];
  type Key = 'name' | 'area' | 'limit' | 'balance';
  const { sorted, sort, toggle } = useSort<Row, Key>(shown, (r, k) => (k === 'name' ? r.name : k === 'area' ? r.area : k === 'limit' ? r.creditLimit : r.balance), { key: 'balance', dir: 'desc' });
  const { page, loadMore } = usePaged(sorted, 30);

  return (
    <>
      <div className="page-head"><div><h1>Khata</h1><p>Outstanding customer balances</p></div></div>
      {error && <p className="error">{error}</p>}

      <StatTiles items={[
        { label: 'Total outstanding', value: <><small>Rs</small>{money(total)}</>, sub: 'to collect from customers', icon: 'khata', tone: total > 0 ? 'amber' : 'green' },
        { label: 'Customers owing', value: owing.length, sub: `of ${rows.length} customers`, icon: 'customers' },
        { label: 'Over limit', value: over, sub: over ? 'need attention' : 'all within their limit', icon: 'alert', tone: over ? 'red' : 'green' },
        { label: 'Biggest balance', value: biggest && Number(biggest.balance) > 0 ? <><small>Rs</small>{money(biggest.balance)}</> : '—', sub: biggest && Number(biggest.balance) > 0 ? biggest.name : undefined, icon: 'trend', tone: 'amber' },
      ]} />

      <div className="list-head">
        <div className="filter"><Icon name="search" /><input aria-label="Search customers" placeholder="Search name, shop, area, phone…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="chips">
          <button type="button" className={`chip${onlyOwing ? ' on' : ''}`} aria-pressed={onlyOwing} onClick={() => setOnlyOwing(true)}>With balance<span className="chip-count">{rows.filter((r) => Number(r.balance) !== 0).length}</span></button>
          <button type="button" className={`chip${!onlyOwing ? ' on' : ''}`} aria-pressed={!onlyOwing} onClick={() => setOnlyOwing(false)}>All customers<span className="chip-count">{rows.length}</span></button>
        </div>
      </div>

      <table className="sticky-head">
        <thead>
          <tr>
            <SortTh k="name" sort={sort} toggle={toggle}>Customer</SortTh>
            <th>Phone</th>
            <SortTh k="limit" sort={sort} toggle={toggle}>Credit used</SortTh>
            <SortTh k="balance" sort={sort} toggle={toggle} num>Balance</SortTh>
            <th>Status</th><th />
          </tr>
        </thead>
        <tbody>
          {!loaded && !error && <SkeletonRows cols={6} />}
          {page.map((r) => {
            const bal = Number(r.balance);
            const limit = r.creditLimit ? Number(r.creditLimit) : 0;
            const used = limit > 0 ? Math.max(0, bal) / limit : 0;
            return (
              <tr key={r.id} {...rowLink(() => router.push(`/khata/${r.id}`))}>
                <td>
                  <span className="person">
                    <Avatar user={{ username: r.name }} size={36} />
                    <span className="person-text">
                      <b>{r.name}</b>
                      <span>{[r.shopName, r.area].filter(Boolean).join(' · ') || 'No shop or area saved'}</span>
                    </span>
                  </span>
                </td>
                <td className="nowrap">{r.phone || <span className="muted">—</span>}</td>
                <td>
                  {limit > 0 ? (
                    <span className="credit">
                      <span className={`meter${used > 1 ? ' over' : used > 0.75 ? ' warn' : ''}`} aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round(used * 100))}%` }} /></span>
                      <span className="credit-text">{Math.round(used * 100)}% of Rs {money(limit)}</span>
                    </span>
                  ) : <span className="muted">No limit set</span>}
                </td>
                <td className="num"><strong className={`bal${r.overLimit ? ' error' : bal < 0 ? ' adv' : bal > 0 ? ' owe' : ''}`}>{bal < 0 ? `Rs ${money(Math.abs(bal))} adv.` : `Rs ${money(bal)}`}</strong></td>
                <td>{r.overLimit ? <span className="badge red">Over limit</span> : bal > 0 ? <span className="badge amber">Owes</span> : bal < 0 ? <span className="badge blue">Advance</span> : <span className="badge green">Clear</span>}</td>
                <td className="row-end"><Link className="pill-link" href={`/khata/${r.id}`} onClick={(e) => e.stopPropagation()}>Open khata<Icon name="chevronRight" /></Link></td>
              </tr>
            );
          })}
          {loaded && !shown.length && (
            <tr><td colSpan={6}><Empty icon="khata" title={search ? `No customer matches “${search}”` : 'Nothing outstanding'} text={onlyOwing && !search ? 'Every customer is clear.' : undefined} action={onlyOwing && <button type="button" className="secondary" onClick={() => setOnlyOwing(false)}>Show all customers</button>} /></td></tr>
          )}
        </tbody>
      </table>
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />
    </>
  );
}
