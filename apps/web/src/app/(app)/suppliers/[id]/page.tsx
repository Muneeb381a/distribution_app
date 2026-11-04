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

const LABEL: Record<string, string> = { PURCHASE: 'Purchase', PAYMENT: 'Payment', RETURN: 'Return', CANCEL: 'Cancelled purchase' };

export default function SupplierLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const { products, locations } = useLookups();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [pay, setPay] = useState({ amount: '', method: 'CASH', note: '' });
  const [ret, setRet] = useState({ locationId: '', productId: '', unitName: '', qty: '', unitPrice: '', fromStatus: 'DAMAGED', note: '' });
  const [error, setError] = useState('');

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
