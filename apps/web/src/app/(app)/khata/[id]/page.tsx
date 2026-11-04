'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';

interface Ledger {
  customer: { id: string; name: string; shopName: string | null; type: string; creditLimit: string | null };
  openingBalance: string;
  balance: string;
  entries: { id: string; date: string; refType: string; refId: string; note: string | null; amount: string; balance: string }[];
  emptiesHeld: { productId: string; name: string; held: number }[];
}

const LABEL: Record<string, string> = { SALE: 'Bill', PAYMENT: 'Payment', SALE_CANCEL: 'Bill cancelled', PAYMENT_CANCEL: 'Payment cancelled' };

export default function CustomerKhataPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [pay, setPay] = useState({ amount: '', method: 'CASH', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  const load = useCallback(() => api<Ledger>(`/khata/${id}`).then(setLedger).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
     
    load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ id: string }>('/payments', {
        method: 'POST',
        json: { clientId, customerId: id, amount: Number(pay.amount), method: pay.method, note: pay.note || undefined },
      });
      setClientId(crypto.randomUUID());
      router.push(`/receipts/${r.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const href = (e: Ledger['entries'][number]) => (e.refType === 'SALE' || e.refType === 'SALE_CANCEL' ? `/sales/${e.refId}` : `/receipts/${e.refId}`);
  const balance = Number(ledger?.balance ?? 0);

  return (
    <>
      <p><Link href="/khata">← Khata</Link></p>
      <h1>{ledger?.customer.name} {ledger?.customer.shopName && <span className="muted">· {ledger.customer.shopName}</span>}</h1>
      {error && <p className="error">{error}</p>}
      {ledger && (
        <p>
          {balance >= 0 ? 'Owes' : 'In credit'}: <strong>Rs {Math.abs(balance).toLocaleString()}</strong>
          {ledger.customer.creditLimit && <span className="muted"> · limit {Number(ledger.customer.creditLimit).toLocaleString()}</span>}
          {ledger.emptiesHeld.map((e) => <span key={e.productId} className="muted"> · holds {e.held} empty {e.name}</span>)}
        </p>
      )}
      <form className="card form" onSubmit={submit}>
        <label>Receive payment<input type="number" step="any" min="0" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
        <label>Method<input value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} /></label>
        <label>Note<input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
        <button disabled={busy}>{busy ? 'Saving…' : 'Save and print receipt'}</button>
      </form>
      <table>
        <thead><tr><th>Date</th><th>Entry</th><th>Ref</th><th>Amount</th><th>Balance</th></tr></thead>
        <tbody>
          {ledger && (
            <tr><td /><td>Opening balance</td><td /><td /><td>{Number(ledger.openingBalance).toLocaleString()}</td></tr>
          )}
          {ledger?.entries.map((e) => (
            <tr key={e.id}>
              <td>{e.date.slice(0, 10)}</td>
              <td>{LABEL[e.refType] ?? e.refType}</td>
              <td><Link href={href(e)}>{e.note}</Link></td>
              <td className={Number(e.amount) < 0 ? 'ok' : ''}>{Number(e.amount).toLocaleString()}</td>
              <td>{Number(e.balance).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
