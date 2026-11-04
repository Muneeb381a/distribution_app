'use client';

import { Noto_Nastaliq_Urdu } from 'next/font/google';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { renderBill } from '@/lib/billImage';
import { allBills, nextBillNo, putBill, type OutboxBill } from '@/lib/offlineDb';

const urdu = Noto_Nastaliq_Urdu({ subsets: ['arabic'], weight: ['400'] });

const onlineStore = {
  subscribe(cb: () => void) {
    window.addEventListener('online', cb);
    window.addEventListener('offline', cb);
    return () => {
      window.removeEventListener('online', cb);
      window.removeEventListener('offline', cb);
    };
  },
  get: () => navigator.onLine,
};

interface SyncResponse { results: { id: string; status: string; reason?: string }[]; serverTotal: number }

export default function PrototypePage() {
  const online = useSyncExternalStore(onlineStore.subscribe, onlineStore.get, () => true);
  const [bills, setBills] = useState<OutboxBill[]>([]);
  const [customer, setCustomer] = useState('Ali Store');
  const [cartons, setCartons] = useState('5');
  const [kg, setKg] = useState('50');
  const [prev, setPrev] = useState('12000');
  const [paid, setPaid] = useState('2000');
  const [image, setImage] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [swReady, setSwReady] = useState(false);

  const note = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 12));
  const refresh = useCallback(() => allBills().then((b) => setBills(b.sort((a, c) => c.createdAt.localeCompare(a.createdAt)))), []);

  useEffect(() => {
    refresh();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then(() => setSwReady(true)).catch(() => note('Service worker failed to register'));
    }
  }, [refresh]);

  async function save() {
    const lines = [
      { name: 'Coca-Cola 1.5 L', unit: 'carton', qty: Number(cartons), rate: 1560 },
      { name: 'Super Kernel Sella', unit: 'kg', qty: Number(kg), rate: 330 },
    ].filter((l) => l.qty > 0);
    const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const bill: OutboxBill = {
      id: crypto.randomUUID(),
      billNo: nextBillNo(),
      createdAt: new Date().toISOString(),
      customer,
      lines,
      previousBalance: Number(prev),
      total,
      paidNow: Number(paid),
      newBalance: Number(prev) + total - Number(paid),
      synced: false,
    };
    await putBill(bill);
    note(`Saved ${bill.billNo} locally (${online ? 'online' : 'OFFLINE'})`);
    await show(bill);
    refresh();
  }

  async function show(bill: OutboxBill) {
    setImage(await renderBill(bill, urdu.style.fontFamily));
  }

  async function sync() {
    const pending = (await allBills()).filter((b) => !b.synced);
    if (!pending.length) return note('Nothing to sync');
    try {
      const res = await api<SyncResponse>('/prototype/sync', { method: 'POST', json: { bills: pending } });
      for (const r of res.results) {
        const bill = pending.find((b) => b.id === r.id)!;
        if (r.status === 'accepted' || r.status === 'duplicate') await putBill({ ...bill, synced: true });
        note(`${bill.billNo}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
      }
      refresh();
    } catch (e) {
      note(`Sync failed, bills stay queued: ${(e as Error).message}`);
    }
  }

  async function resendAll() {
    const all = await allBills();
    const res = await api<SyncResponse>('/prototype/sync', { method: 'POST', json: { bills: all } });
    note(`Re-sent ${all.length} bills: ${res.results.map((r) => r.status).join(', ')} (server holds ${res.serverTotal})`);
  }

  return (
    <>
      <div className="no-print">
        <h1>Offline & printing prototype</h1>
        <p className="muted">
          Throwaway page to prove three things on your real devices: the app opens and bills save with no internet, bills sync once
          without duplicates, and the Urdu bill prints correctly on your thermal printer.
        </p>
        <div className="toolbar">
          <strong className={online ? 'ok' : 'error'}>{online ? 'Online' : 'OFFLINE'}</strong>
          <span className="muted">Offline page cache: {swReady ? 'active (reload once while online, then try offline)' : 'not ready'}</span>
        </div>
        <div className="card form">
          <label>Customer<input value={customer} onChange={(e) => setCustomer(e.target.value)} /></label>
          <label>Coke 1.5 L cartons<input type="number" value={cartons} onChange={(e) => setCartons(e.target.value)} /></label>
          <label>Rice kg<input type="number" value={kg} onChange={(e) => setKg(e.target.value)} /></label>
          <label>Previous balance<input type="number" value={prev} onChange={(e) => setPrev(e.target.value)} /></label>
          <label>Paid now<input type="number" value={paid} onChange={(e) => setPaid(e.target.value)} /></label>
          <button onClick={save}>Save bill</button>
        </div>
        <div className="toolbar">
          <button onClick={sync} disabled={!online}>Sync now</button>
          <button className="secondary" onClick={resendAll} disabled={!online}>Re-send everything (duplicate test)</button>
          {image && <button className="secondary" onClick={() => window.print()}>Print bill</button>}
        </div>
        <table>
          <thead><tr><th>Bill no.</th><th>Customer</th><th>Total</th><th>Status</th><th /></tr></thead>
          <tbody>
            {bills.map((b) => (
              <tr key={b.id}>
                <td>{b.billNo}</td><td>{b.customer}</td><td>{b.total.toLocaleString()}</td>
                <td className={b.synced ? 'ok' : ''}>{b.synced ? 'Synced' : 'Waiting to sync'}</td>
                <td><button className="secondary" onClick={() => show(b)}>Preview</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <pre className="muted">{log.join('\n')}</pre>
      </div>
      {image && (
        <div className="print-area card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Bill" style={{ width: '80mm', maxWidth: '100%' }} />
        </div>
      )}
    </>
  );
}
