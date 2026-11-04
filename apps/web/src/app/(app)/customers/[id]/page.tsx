'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, can, useUser } from '@/lib/api';

interface Unit { unitName: string; factorToBase: string }
interface Product { id: string; name: string; size: string | null; units: Unit[] }
interface Customer { id: string; name: string; shopName: string | null; type: string; creditLimit: string | null }
interface RateRow { productId: string; unitName: string; rate: string }

export default function CustomerRatesPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [rows, setRows] = useState<RateRow[]>([]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const canEdit = can(useUser(), 'RATE_EDIT');

  useEffect(() => {
    Promise.all([
      api<Customer & { rates: { productId: string; unitName: string; rate: string }[] }>(`/customers/${id}`),
      api<Product[]>('/products'),
    ])
      .then(([c, p]) => {
        setCustomer(c);
        setProducts(p);
        setRows(c.rates.map((r) => ({ productId: r.productId, unitName: r.unitName, rate: String(Number(r.rate)) })));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const update = (i: number, patch: Partial<RateRow>) => {
    setSaved(false);
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  async function save() {
    setError('');
    try {
      await api(`/customers/${id}/rates`, {
        method: 'PUT',
        json: { rates: rows.filter((r) => r.productId && r.rate !== '').map((r) => ({ ...r, rate: Number(r.rate) })) },
      });
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const unitsOf = (productId: string) => products.find((p) => p.id === productId)?.units ?? [];

  return (
    <>
      <p><Link href="/customers">← Customers</Link></p>
      <h1>Rates: {customer?.name} {customer?.shopName && <span className="muted">({customer.shopName})</span>}</h1>
      <p className="muted">Fixed rate per product and unit. On a bill this pre-fills, and users with the rate-edit permission can change it.</p>
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>Product</th><th>Unit</th><th>Rate (Rs)</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                <select disabled={!canEdit} value={r.productId} onChange={(e) => update(i, { productId: e.target.value, unitName: unitsOf(e.target.value)[0]?.unitName ?? '' })}>
                  <option value="">Select product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </td>
              <td>
                <select disabled={!canEdit} value={r.unitName} onChange={(e) => update(i, { unitName: e.target.value })}>
                  {unitsOf(r.productId).map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
                </select>
              </td>
              <td><input type="number" step="any" min="0" disabled={!canEdit} value={r.rate} onChange={(e) => update(i, { rate: e.target.value })} /></td>
              <td>{canEdit && <button className="secondary" onClick={() => { setSaved(false); setRows(rows.filter((_, j) => j !== i)); }}>Remove</button>}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="muted">No fixed rates yet.</td></tr>}
        </tbody>
      </table>
      {canEdit && (
        <div className="toolbar" style={{ marginTop: 16 }}>
          <button className="secondary" onClick={() => setRows([...rows, { productId: '', unitName: '', rate: '' }])}>Add rate</button>
          <button onClick={save}>Save rates</button>
          {saved && <span className="ok">Saved</span>}
        </div>
      )}
    </>
  );
}
