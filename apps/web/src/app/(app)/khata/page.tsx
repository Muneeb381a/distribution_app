'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';

interface Row {
  id: string; name: string; shopName: string | null; area: string | null; phone: string | null;
  type: string; creditLimit: string | null; balance: string; overLimit: boolean;
}

const n = (v: string | number) => Number(v).toLocaleString();

export default function KhataPage() {
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
        <div className="filter"><Icon name="search" /><input placeholder="Search name, shop, area, phone…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <button className={`chip${onlyOwing ? ' on' : ''}`} onClick={() => setOnlyOwing(true)}>With balance</button>
        <button className={`chip${!onlyOwing ? ' on' : ''}`} onClick={() => setOnlyOwing(false)}>All customers</button>
      </div>

      <table>
        <thead><tr><th>Customer</th><th>Area</th><th>Phone</th><th className="num">Limit</th><th className="num">Balance</th><th>Status</th><th /></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id}>
              <td><strong>{r.name}</strong>{r.shopName && <span className="muted"> · {r.shopName}</span>}</td>
              <td>{r.area}</td>
              <td>{r.phone}</td>
              <td className="num">{r.creditLimit ? n(r.creditLimit) : '—'}</td>
              <td className="num"><strong className={r.overLimit ? 'error' : ''}>{n(r.balance)}</strong></td>
              <td>{r.overLimit ? <span className="badge red">Over limit</span> : Number(r.balance) > 0 ? <span className="badge amber">Owes</span> : Number(r.balance) < 0 ? <span className="badge blue">Advance</span> : <span className="badge green">Clear</span>}</td>
              <td><Link href={`/khata/${r.id}`}>Open →</Link></td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={7} className="empty">{!loaded ? 'Loading…' : 'Nothing outstanding.'}</td></tr>}
        </tbody>
      </table>
    </>
  );
}
