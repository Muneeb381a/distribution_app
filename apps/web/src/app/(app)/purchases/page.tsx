'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { productLabel, useLookups } from '@/lib/lookups';

interface Purchase {
  id: string; purchaseNo: string; date: string; total: string; paidNow: string; status: string;
  supplier: { name: string }; location: { name: string };
}
interface Line { productId: string; unitName: string; qty: string; unitPrice: string }
const emptyLine: Line = { productId: '', unitName: '', qty: '', unitPrice: '' };
const today = () => new Date().toISOString().slice(0, 10);

export default function PurchasesPage() {
  const { products, locations, suppliers, error: lookupError } = useLookups();
  const [list, setList] = useState<Purchase[]>([]);
  const [head, setHead] = useState({ supplierId: '', locationId: '', date: today(), paidNow: '', note: '' });
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Purchase[]>('/purchases').then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => {
     
    load();
  }, [load]);

  const prod = (id: string) => products.find((p) => p.id === id);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/purchases', {
        method: 'POST',
        json: {
          supplierId: head.supplierId,
          locationId: head.locationId,
          date: head.date,
          paidNow: head.paidNow ? Number(head.paidNow) : undefined,
          note: head.note || undefined,
          items: lines.map((l) => ({ productId: l.productId, unitName: l.unitName, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
        },
      });
      setLines([{ ...emptyLine }]);
      setHead({ ...head, paidNow: '', note: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(p: Purchase) {
    if (!confirm(`Cancel ${p.purchaseNo}? Stock and the supplier balance will be reversed.`)) return;
    setError('');
    try {
      await api(`/purchases/${p.id}/cancel`, { method: 'POST', json: {} });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-head"><div><h1>Purchases</h1><p>Record stock bought from suppliers</p></div></div>
      {(error || lookupError) && <p className="error">{error || lookupError}</p>}
      <form className="card" onSubmit={submit}>
        <h3>New purchase</h3>
        <div className="form">
          <label>Supplier
            <select required value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}>
              <option value="">—</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Received into
            <select required value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}>
              <option value="">—</option>
              {locations.filter((l) => l.type !== 'VEHICLE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label>Date<input type="date" required value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} /></label>
        </div>
        {lines.map((l, i) => (
          <div className="form" key={i} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
            <label>Product
              <select required value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value, unitName: prod(e.target.value)?.units[0]?.unitName ?? '' })}>
                <option value="">—</option>
                {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
              </select>
            </label>
            <label>Unit
              <select required value={l.unitName} onChange={(e) => setLine(i, { unitName: e.target.value })}>
                {prod(l.productId)?.units.map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
              </select>
            </label>
            <label>Qty<input type="number" step="any" min="0" required value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
            <label>Price per unit<input type="number" step="any" min="0" required value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></label>
            <span className="badge" style={{ alignSelf: 'center' }}>= Rs {((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)).toLocaleString()}</span>
            {lines.length > 1 && <button type="button" className="secondary" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        <div className="form" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button type="button" className="secondary" onClick={() => setLines([...lines, { ...emptyLine }])}>+ Add item</button>
          <label>Paid now<input type="number" step="any" min="0" max={total} value={head.paidNow} onChange={(e) => setHead({ ...head, paidNow: e.target.value })} /></label>
          <label>Note<input value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} /></label>
          <strong style={{ fontSize: 18 }}>Total Rs {total.toLocaleString()}</strong>
          <button disabled={busy}>{busy ? 'Saving…' : 'Save purchase'}</button>
        </div>
      </form>
      <h2>Purchase history</h2>
      <table>
        <thead><tr><th>No.</th><th>Date</th><th>Supplier</th><th>Into</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th /></tr></thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.purchaseNo}</strong></td>
              <td>{p.date.slice(0, 10)}</td>
              <td>{p.supplier.name}</td>
              <td>{p.location.name}</td>
              <td className="num"><strong>{Number(p.total).toLocaleString()}</strong></td>
              <td className="num">{Number(p.paidNow).toLocaleString()}</td>
              <td>{p.status === 'CANCELLED' ? <span className="badge red">Cancelled</span> : Number(p.total) > Number(p.paidNow) ? <span className="badge amber">Due {(Number(p.total) - Number(p.paidNow)).toLocaleString()}</span> : <span className="badge green">Paid</span>}</td>
              <td>{p.status === 'ACTIVE' && <button className="secondary" onClick={() => cancel(p)}>Cancel</button>}</td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={8} className="empty">No purchases yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
