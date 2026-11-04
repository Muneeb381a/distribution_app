'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, can, useUser } from '@/lib/api';
import { productLabel, useLookups } from '@/lib/lookups';

interface Ledger {
  supplier: { id: string; name: string };
  openingBalance: string;
  balance: string;
  entries: { id: string; date: string; refType: string; note: string | null; amount: string; balance: string }[];
}

interface EmptiesEntry { id: string; date: string; qtyIn: number; qtyOut: number; note: string | null; status: string; product: { name: string; size: string | null } }
interface EmptiesData { entries: EmptiesEntry[]; owed: { productId: string; product: string; owed: number }[] }

const LABEL: Record<string, string> = { PURCHASE: 'Purchase', PAYMENT: 'Payment', RETURN: 'Return', CANCEL: 'Cancelled purchase' };

export default function SupplierLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const { products, locations } = useLookups();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [pay, setPay] = useState({ amount: '', method: 'CASH', note: '' });
  const [ret, setRet] = useState({ locationId: '', productId: '', unitName: '', qty: '', unitPrice: '', fromStatus: 'DAMAGED', note: '' });
  const [error, setError] = useState('');
  const [empties, setEmpties] = useState<EmptiesData | null>(null);
  const [emp, setEmp] = useState({ direction: 'RECEIVED', productId: '', qty: '', note: '' });
  const canEmpties = can(user, 'PURCHASE_MANAGE');

  const loadEmpties = useCallback(() => {
    if (canEmpties) api<EmptiesData>(`/supplier-empties?supplierId=${id}`).then(setEmpties).catch((e) => setError(e.message));
  }, [id, canEmpties]);
  useEffect(() => {
    loadEmpties();
  }, [loadEmpties]);

  const load = useCallback(() => api<Ledger>(`/suppliers/${id}/ledger`).then(setLedger).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
     
    load();
  }, [load]);

  async function post(path: string, json: unknown) {
    setError('');
    try {
      await api(path, { method: 'POST', json });
      await load();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  async function submitPay(e: FormEvent) {
    e.preventDefault();
    if (await post('/supplier-payments', { supplierId: id, amount: Number(pay.amount), method: pay.method, note: pay.note || undefined })) {
      setPay({ ...pay, amount: '', note: '' });
    }
  }

  async function submitReturn(e: FormEvent) {
    e.preventDefault();
    const ok = await post('/purchase-returns', {
      supplierId: id,
      locationId: ret.locationId,
      note: ret.note || undefined,
      items: [{ productId: ret.productId, unitName: ret.unitName, qty: Number(ret.qty), unitPrice: Number(ret.unitPrice), fromStatus: ret.fromStatus }],
    });
    if (ok) setRet({ ...ret, qty: '', unitPrice: '', note: '' });
  }

  async function submitEmpties(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/supplier-empties', { method: 'POST', json: { supplierId: id, direction: emp.direction, productId: emp.productId, qty: Math.round(Number(emp.qty)), note: emp.note || undefined } });
      setEmp({ ...emp, qty: '', note: '' });
      loadEmpties();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function cancelEmpties(entryId: string) {
    if (!confirm('Cancel this empties entry?')) return;
    try {
      await api(`/supplier-empties/${entryId}/cancel`, { method: 'POST', json: {} });
      loadEmpties();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const owed = Number(ledger?.balance ?? 0);

  return (
    <>
      <p><Link href="/suppliers">← Suppliers</Link></p>
      <h1>{ledger?.supplier.name} <span className="muted">ledger</span></h1>
      {error && <p className="error">{error}</p>}
      {ledger && (
        <p>
          {owed >= 0 ? 'We owe them' : 'They owe us'}: <strong>Rs {Math.abs(owed).toLocaleString()}</strong>
          <span className="muted"> (opening balance {Number(ledger.openingBalance).toLocaleString()})</span>
        </p>
      )}
      <div className="grid2">
        {can(user, 'SUPPLIER_PAYMENT') && (
          <form className="card form" onSubmit={submitPay}>
            <label>Pay supplier<input type="number" step="any" min="0" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
            <label>Method<input value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} /></label>
            <label>Note<input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
            <button>Record payment</button>
          </form>
        )}
        {can(user, 'PURCHASE_MANAGE') && (
          <form className="card form" onSubmit={submitReturn}>
            <label>Return from
              <select required value={ret.locationId} onChange={(e) => setRet({ ...ret, locationId: e.target.value })}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label>Stock
              <select value={ret.fromStatus} onChange={(e) => setRet({ ...ret, fromStatus: e.target.value })}>
                <option value="DAMAGED">Damaged</option>
                <option value="OK">Saleable</option>
              </select>
            </label>
            <label>Product
              <select required value={ret.productId} onChange={(e) => setRet({ ...ret, productId: e.target.value, unitName: products.find((p) => p.id === e.target.value)?.units[0]?.unitName ?? '' })}>
                <option value="">—</option>
                {products.map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
              </select>
            </label>
            <label>Unit
              <select required value={ret.unitName} onChange={(e) => setRet({ ...ret, unitName: e.target.value })}>
                {products.find((p) => p.id === ret.productId)?.units.map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
              </select>
            </label>
            <label>Qty<input type="number" step="any" min="0" required value={ret.qty} onChange={(e) => setRet({ ...ret, qty: e.target.value })} /></label>
            <label>Credit per unit<input type="number" step="any" min="0" required value={ret.unitPrice} onChange={(e) => setRet({ ...ret, unitPrice: e.target.value })} /></label>
            <button>Return to supplier</button>
          </form>
        )}
      </div>
      {canEmpties && empties && (
        <>
          <h2>Empties (bottles / crates)</h2>
          <div className="grid2">
            <form className="card form" onSubmit={submitEmpties}>
              <label>What happened
                <select value={emp.direction} onChange={(e) => setEmp({ ...emp, direction: e.target.value })}>
                  <option value="RECEIVED">Received empties from supplier</option>
                  <option value="RETURNED">Sent empties back to supplier</option>
                </select>
              </label>
              <label>Product
                <select required value={emp.productId} onChange={(e) => setEmp({ ...emp, productId: e.target.value })}>
                  <option value="">Select…</option>
                  {products.filter((p) => p.returnableEmpty).map((p) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                </select>
              </label>
              <label>Empties<input type="number" min="1" step="1" required value={emp.qty} onChange={(e) => setEmp({ ...emp, qty: e.target.value })} /></label>
              <label>Note<input value={emp.note} onChange={(e) => setEmp({ ...emp, note: e.target.value })} /></label>
              <div className="form-actions"><button>Save</button></div>
            </form>
            <div className="card">
              <h3>Still to return to this supplier</h3>
              {empties.owed.length ? (
                <ul className="list">
                  {empties.owed.map((o) => (
                    <li key={o.productId}><span>{o.product}</span><span className={`badge ${o.owed > 0 ? 'amber' : 'blue'}`}>{o.owed > 0 ? `${o.owed} to return` : `supplier owes us ${-o.owed}`}</span></li>
                  ))}
                </ul>
              ) : <p className="muted" style={{ margin: 0 }}>Nothing owed either way.</p>}
            </div>
          </div>
          {empties.entries.length > 0 && (
            <table>
              <thead><tr><th>Date</th><th>Product</th><th className="num">Received</th><th className="num">Returned</th><th>Note</th><th /></tr></thead>
              <tbody>
                {empties.entries.map((e) => (
                  <tr key={e.id} style={e.status === 'CANCELLED' ? { opacity: 0.5, textDecoration: 'line-through' } : undefined}>
                    <td>{e.date.slice(0, 10)}</td><td>{e.product.name}</td>
                    <td className="num">{e.qtyIn || '—'}</td><td className="num">{e.qtyOut || '—'}</td>
                    <td className="muted">{e.note}</td>
                    <td>{e.status === 'ACTIVE' && <button className="secondary" onClick={() => cancelEmpties(e.id)}>Cancel</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h2>Money ledger</h2>
        </>
      )}
      <table>
        <thead><tr><th>Date</th><th>Entry</th><th>Ref</th><th>Amount</th><th>Balance</th></tr></thead>
        <tbody>
          {ledger?.entries.map((e) => (
            <tr key={e.id}>
              <td>{e.date.slice(0, 10)}</td>
              <td>{LABEL[e.refType] ?? e.refType}</td>
              <td className="muted">{e.note}</td>
              <td className={Number(e.amount) < 0 ? 'ok' : ''}>{Number(e.amount).toLocaleString()}</td>
              <td>{Number(e.balance).toLocaleString()}</td>
            </tr>
          ))}
          {!ledger?.entries.length && <tr><td colSpan={5} className="muted">No entries yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
