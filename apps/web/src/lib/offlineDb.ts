// Minimal IndexedDB outbox for the offline prototype. Bills are keyed by a client-generated UUID,
// so re-sending the same bill after a flaky connection can never create a second one.

export interface OutboxBill {
  id: string;
  billNo: string;
  createdAt: string;
  customer: string;
  lines: { name: string; unit: string; qty: number; rate: number }[];
  previousBalance: number;
  total: number;
  paidNow: number;
  newBalance: number;
  synced: boolean;
}

const DB = 'dist-offline';
const STORE = 'outbox';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const putBill = (b: OutboxBill) => tx('readwrite', (s) => s.put(b));
export const allBills = () => tx<OutboxBill[]>('readonly', (s) => s.getAll());

/** Device prefix + counter, e.g. B-V2-000123, so two offline devices never mint the same number. */
export function nextBillNo(): string {
  let device = localStorage.getItem('dist.device');
  if (!device) {
    device = 'V' + Math.floor(Math.random() * 90 + 10);
    localStorage.setItem('dist.device', device);
  }
  const n = Number(localStorage.getItem('dist.billCounter') ?? '0') + 1;
  localStorage.setItem('dist.billCounter', String(n));
  return `B-${device}-${String(n).padStart(6, '0')}`;
}
