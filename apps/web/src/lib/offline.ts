'use client';

// Offline billing: a snapshot of what the bill screen needs, an outbox of bills and receipts saved
// without the server, device-prefixed numbers, and a sync loop. Everything lives in IndexedDB on this PC.

import { useSyncExternalStore } from 'react';
import { api, ApiError, getUser } from './api';
import type { BillData, ReceiptData } from './saleImage';

/* ------------------------------------------------------------------ types */

export interface SnapProduct {
  id: string; name: string; size: string | null; baseUnit: string; returnableEmpty: boolean; isActive: boolean;
  units: { unitName: string; factorToBase: string }[];
  category: { name: string; businessLine: { code: 'BOTTLES' | 'RICE' } };
}
export interface SnapCustomer { id: string; name: string; shopName: string | null; area: string | null; phone: string | null; type: 'CASH' | 'CREDIT'; creditLimit: string | null; balance: string }
export interface Snapshot {
  at: string;
  products: SnapProduct[];
  prices: { productId: string; unitName: string; rate: string }[];
  locations: { id: string; name: string; type: string }[];
  salesmen: { id: string; name: string }[];
  customers: SnapCustomer[];
  rates: { customerId: string; productId: string; unitName: string; rate: string }[];
  stock: { productId: string; locationId: string; qtyBase: string }[];
  empties: { customerId: string; productId: string; held: number }[];
}

export interface SaleBody {
  saleType: string; customerId?: string; locationId: string; salesmanId?: string; paidNow?: number; method?: string; note?: string; date?: string;
  items: { productId: string; unitName: string; qty: number; rate?: number }[];
  returns: { productId: string; unitName: string; qty: number; rate?: number; reason: string }[];
  emptiesCollected: { productId: string; qty: number }[];
  overrideCredit?: boolean;
}
export interface PaymentBody { customerId: string; amount: number; method?: string; note?: string; date?: string }

export type OpStatus = 'pending' | 'failed' | 'done';
export interface OutboxOp {
  clientId: string;
  kind: 'SALE' | 'PAYMENT';
  number: string;
  savedAt: string;
  status: OpStatus;
  attempts: number;
  error?: string;
  flags?: string[];
  serverId?: string;
  syncedAt?: string;
  sale?: SaleBody;
  payment?: PaymentBody;
  /** Effect on the customer's balance (bill net − paid, or −amount) and stock used, for later previews. */
  customerId?: string;
  balanceDelta: number;
  stockUsed: { productId: string; locationId: string; qtyBase: number }[];
  emptiesDelta: { productId: string; qty: number }[];
  /** What was printed, so it can be reprinted offline. */
  bill?: BillData;
  receipt?: ReceiptData;
}

export interface Preview {
  gross: string; returnsCredit: string; net: string; paid: string; previousBalance: string; newBalance: string;
  items: { rate: string; amount: string }[]; returns: { rate: string; amount: string }[];
  credit: { limit: string | null; available: string | null; blocked: string | null };
  empties: { productName: string; given: number; collected: number; heldAfter: number }[];
  shortages: string[];
  businessLine: 'BOTTLES' | 'RICE';
}

/* --------------------------------------------------------------- indexeddb */

const DB = 'dist-offline-v2';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('outbox', { keyPath: 'clientId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}
async function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(store, mode).objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const kvGet = <T>(k: string) => run<T | undefined>('kv', 'readonly', (s) => s.get(k) as IDBRequest<T | undefined>);
const kvSet = (k: string, v: unknown) => run('kv', 'readwrite', (s) => s.put(v, k));
export const allOps = () => run<OutboxOp[]>('outbox', 'readonly', (s) => s.getAll()).then((r) => r.sort((a, b) => a.savedAt.localeCompare(b.savedAt)));
const putOp = (op: OutboxOp) => run('outbox', 'readwrite', (s) => s.put(op));
const delOp = (id: string) => run('outbox', 'readwrite', (s) => s.delete(id));

/* ------------------------------------------------------------------- state */

export interface SyncState {
  /** The server answered recently. */
  reachable: boolean;
  syncing: boolean;
  pending: number;
  failed: number;
  lastSync: string | null;
  snapshotAt: string | null;
  prefix: string | null;
}
let state: SyncState = { reachable: true, syncing: false, pending: 0, failed: 0, lastSync: null, snapshotAt: null, prefix: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<SyncState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
const SERVER_STATE: SyncState = state;

export function useSyncState(): SyncState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => SERVER_STATE);
}
/** Re-render when the outbox changes. */
const opsListeners = new Set<() => void>();
let opsVersion = 0;
export function useOutboxVersion() {
  return useSyncExternalStore((cb) => { opsListeners.add(cb); return () => opsListeners.delete(cb); }, () => opsVersion, () => 0);
}
function opsChanged() { opsVersion++; opsListeners.forEach((l) => l()); }

async function recount() {
  const ops = await allOps();
  set({ pending: ops.filter((o) => o.status === 'pending').length, failed: ops.filter((o) => o.status === 'failed').length });
  opsChanged();
}

export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

/* ------------------------------------------------------------ device number */

const PREFIX_KEY = 'dist.device.prefix';
const counterKey = (kind: string) => `dist.device.counter.${kind}`;

/** Asks the server once for this PC's prefix (D1, D2…). Needs to be online the first time. */
export async function ensureDevice(): Promise<string | null> {
  try {
    const have = localStorage.getItem(PREFIX_KEY);
    if (have) { if (state.prefix !== have) set({ prefix: have }); return have; }
    const { prefix } = await api<{ prefix: string }>('/sync/device', { method: 'POST', json: {} });
    localStorage.setItem(PREFIX_KEY, prefix);
    set({ prefix });
    return prefix;
  } catch {
    return null;
  }
}

/** BTL-D2-000014: device prefix plus a counter per document kind, kept on this PC. */
function nextNumber(kind: 'BTL' | 'RIC' | 'RCP', prefix: string) {
  const n = Number(localStorage.getItem(counterKey(kind)) ?? '0') + 1;
  localStorage.setItem(counterKey(kind), String(n));
  return `${kind}-${prefix}-${String(n).padStart(6, '0')}`;
}

/* ---------------------------------------------------------------- snapshot */

export async function getSnapshot(): Promise<Snapshot | null> {
  try {
    const s = (await kvGet<Snapshot>('snapshot')) ?? null;
    if (s && state.snapshotAt !== s.at) set({ snapshotAt: s.at });
    return s;
  } catch {
    return null;
  }
}

export async function refreshSnapshot(): Promise<Snapshot | null> {
  if (!getUser()?.permissions.includes('SALE_CREATE')) return null;
  try {
    const s = await api<Snapshot>('/sync/snapshot');
    await kvSet('snapshot', s);
    set({ snapshotAt: s.at, reachable: true });
    return s;
  } catch (e) {
    if (isNetworkError(e)) set({ reachable: false });
    return null;
  }
}

/* -------------------------------------------------------------------- sync */

let syncing: Promise<void> | null = null;

/** Sends pending operations in the order they were saved. Safe to call any time. */
export function syncNow(): Promise<void> {
  syncing ??= (async () => {
    const ops = (await allOps()).filter((o) => o.status === 'pending');
    if (!ops.length) {
      await ping();
      return;
    }
    set({ syncing: true });
    try {
      for (let i = 0; i < ops.length; i += 50) {
        const batch = ops.slice(i, i + 50);
        const { results } = await api<{ results: { clientId: string; status: string; id?: string; number?: string; flags?: string[]; error?: string }[] }>('/sync/push', {
          method: 'POST',
          json: { ops: batch.map((o) => ({ kind: o.kind, clientId: o.clientId, number: o.number, savedAt: o.savedAt, sale: o.sale, payment: o.payment })) },
        });
        for (const r of results) {
          const op = batch.find((o) => o.clientId === r.clientId);
          if (!op) continue;
          op.attempts += 1;
          if (r.status === 'created' || r.status === 'duplicate') {
            // Reached the server before the connection dropped: the server's number wins, the slip shows ours.
            const renamed = r.number && r.number !== op.number ? [`Saved on the server as ${r.number} (the printed slip says ${op.number})`] : [];
            Object.assign(op, { status: 'done', serverId: r.id, flags: [...(r.flags ?? []), ...renamed], error: undefined, syncedAt: new Date().toISOString() });
          } else if (r.status === 'failed') {
            Object.assign(op, { status: 'failed', error: r.error });
          } else {
            op.error = r.error;
          }
          await putOp(op);
        }
      }
      set({ reachable: true, lastSync: new Date().toISOString() });
      await pruneDone();
      await refreshSnapshot();
    } catch (e) {
      if (isNetworkError(e)) set({ reachable: false });
    } finally {
      set({ syncing: false });
      await recount();
    }
  })().finally(() => { syncing = null; });
  return syncing;
}

/** Is the server there? (navigator.onLine is true on a LAN with no internet.) */
export async function ping(): Promise<boolean> {
  try {
    await api('/auth/me');
    set({ reachable: true });
    return true;
  } catch (e) {
    const ok = !isNetworkError(e);
    set({ reachable: ok });
    return ok;
  }
}

/** Synced documents stay a week for reprinting, then go. */
async function pruneDone() {
  const cutoff = Date.now() - 7 * 86_400_000;
  for (const o of await allOps()) if (o.status === 'done' && o.syncedAt && Date.parse(o.syncedAt) < cutoff) await delOp(o.clientId);
}

export async function retryOp(clientId: string) {
  const op = (await allOps()).find((o) => o.clientId === clientId);
  if (!op) return;
  await putOp({ ...op, status: 'pending', error: undefined });
  await recount();
  await syncNow();
}

export async function discardOp(clientId: string) {
  await delOp(clientId);
  await recount();
}

let started = false;
/** Starts the background loop once per page load. */
export function startSync() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const kick = () => { void syncNow(); };
  window.addEventListener('online', kick);
  window.addEventListener('offline', () => set({ reachable: false }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  setInterval(kick, 30_000);
  setInterval(() => { if (state.reachable) void refreshSnapshot(); }, 5 * 60_000);
  try { set({ prefix: localStorage.getItem(PREFIX_KEY) }); } catch { /* storage blocked */ }
  void (async () => {
    await getSnapshot();
    await recount();
    if (await ping()) {
      await ensureDevice();
      await refreshSnapshot();
      await syncNow();
    }
  })();
}

/* ---------------------------------------------------------- local preview */

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => String(round2(n));
const factor = (p: SnapProduct, unit: string) => Number(p.units.find((u) => u.unitName === unit)?.factorToBase ?? NaN);

/** Balance, stock and empties as the snapshot saw them, plus everything still waiting in the outbox. */
async function adjusted(s: Snapshot) {
  const ops = (await allOps()).filter((o) => o.status !== 'done' || !o.syncedAt || o.syncedAt > s.at);
  const balance = new Map(s.customers.map((c) => [c.id, Number(c.balance)]));
  const stock = new Map(s.stock.map((x) => [`${x.productId}|${x.locationId}`, Number(x.qtyBase)]));
  const empties = new Map(s.empties.map((e) => [`${e.customerId}|${e.productId}`, e.held]));
  for (const o of ops) {
    if (o.status === 'failed') continue;
    if (o.customerId) balance.set(o.customerId, (balance.get(o.customerId) ?? 0) + o.balanceDelta);
    for (const u of o.stockUsed) stock.set(`${u.productId}|${u.locationId}`, (stock.get(`${u.productId}|${u.locationId}`) ?? 0) - u.qtyBase);
    if (o.customerId) for (const e of o.emptiesDelta) empties.set(`${o.customerId}|${e.productId}`, (empties.get(`${o.customerId}|${e.productId}`) ?? 0) + e.qty);
  }
  return { balance, stock, empties };
}

/**
 * The same rules the server applies (rates, line mixing, payment, credit limit, stock, empties),
 * computed from the snapshot. Throws Error with the server's wording when the bill is not valid.
 */
export async function previewOffline(s: Snapshot, b: SaleBody, perms: string[]): Promise<Preview> {
  if (!b.items.length && !b.returns.length) throw new Error('Add at least one item or return');
  const loc = s.locations.find((l) => l.id === b.locationId);
  if (!loc) throw new Error('Unknown or inactive location');
  if (b.saleType === 'DELIVERY' && !b.salesmanId) throw new Error('A delivery needs a salesman');
  if (b.saleType === 'DELIVERY' && !b.customerId) throw new Error('A delivery needs a customer');
  const customer = b.customerId ? s.customers.find((c) => c.id === b.customerId) : undefined;
  if (b.customerId && !customer) throw new Error('Unknown or inactive customer');
  const adj = await adjusted(s);

  const resolve = (l: { productId: string; unitName: string; qty: number; rate?: number }) => {
    const p = s.products.find((x) => x.id === l.productId);
    if (!p) throw new Error('Unknown or inactive product');
    const f = factor(p, l.unitName);
    if (!f) throw new Error(`${p.name} has no unit ${l.unitName}`);
    const fixed = customer && s.rates.find((r) => r.customerId === customer.id && r.productId === p.id && r.unitName === l.unitName)?.rate;
    const list = s.prices.find((r) => r.productId === p.id && r.unitName === l.unitName)?.rate;
    const standard = fixed ?? list;
    let rate: number;
    if (l.rate == null) {
      if (!standard) throw new Error(`No rate is set for ${p.name} (${l.unitName}); ${perms.includes('RATE_EDIT') ? 'enter one' : 'ask someone who can set rates'}`);
      rate = Number(standard);
    } else {
      rate = l.rate;
      if ((!standard || rate !== Number(standard)) && !perms.includes('RATE_EDIT')) throw new Error(`You are not allowed to change the rate of ${p.name}`);
    }
    return { p, qtyBase: l.qty * f, rate, amount: round2(l.qty * rate) };
  };
  const items = b.items.map(resolve);
  const returns = b.returns.map(resolve);
  const lines = new Set([...items, ...returns].map((l) => l.p.category.businessLine.code));
  if (lines.size > 1) throw new Error('A bill can hold bottles or rice, not both. Make two bills.');
  const businessLine = [...lines][0];

  const gross = round2(items.reduce((x, l) => x + l.amount, 0));
  const returnsCredit = round2(returns.reduce((x, l) => x + l.amount, 0));
  const net = round2(gross - returnsCredit);
  const cashLike = !customer || customer.type === 'CASH';
  const paid = b.paidNow ?? (cashLike ? Math.max(net, 0) : 0);
  if (net < 0 && paid > 0) throw new Error('A bill that credits the customer cannot also take payment');
  if (!customer && paid !== net) throw new Error('A sale without a customer must be paid in full');
  const previousBalance = customer ? round2(adj.balance.get(customer.id) ?? 0) : 0;
  const newBalance = round2(previousBalance + net - paid);

  let blocked: string | null = null;
  if (customer && net - paid > 0) {
    if (customer.type === 'CASH') blocked = 'CASH_CUSTOMER_UNPAID: a cash customer must pay in full';
    else if (customer.creditLimit && newBalance > Number(customer.creditLimit)) blocked = `CREDIT_LIMIT_EXCEEDED: balance would be ${newBalance} against a limit of ${Number(customer.creditLimit)}`;
  }

  const empties: Preview['empties'] = [];
  if (customer) {
    const given = new Map<string, number>();
    for (const l of items) if (l.p.returnableEmpty) given.set(l.p.id, (given.get(l.p.id) ?? 0) + Math.round(l.qtyBase));
    const collected = new Map<string, number>();
    for (const c of b.emptiesCollected) collected.set(c.productId, (collected.get(c.productId) ?? 0) + c.qty);
    for (const pid of new Set([...given.keys(), ...collected.keys()])) {
      const before = adj.empties.get(`${customer.id}|${pid}`) ?? 0;
      const g = given.get(pid) ?? 0, c = collected.get(pid) ?? 0;
      empties.push({ productName: s.products.find((x) => x.id === pid)?.name ?? '', given: g, collected: c, heldAfter: before + g - c });
    }
  } else if (b.emptiesCollected.length) throw new Error('Empties are tracked per customer');

  const need = new Map<string, number>();
  for (const l of items) need.set(l.p.id, (need.get(l.p.id) ?? 0) + l.qtyBase);
  const shortages: string[] = [];
  for (const [pid, qty] of need) {
    const have = adj.stock.get(`${pid}|${b.locationId}`) ?? 0;
    if (have < qty) shortages.push(`${s.products.find((x) => x.id === pid)?.name}: have ${have}, need ${qty}`);
  }

  return {
    gross: fmt(gross), returnsCredit: fmt(returnsCredit), net: fmt(net), paid: fmt(paid), previousBalance: fmt(previousBalance), newBalance: fmt(newBalance),
    items: items.map((l) => ({ rate: fmt(l.rate), amount: fmt(l.amount) })),
    returns: returns.map((l) => ({ rate: fmt(l.rate), amount: fmt(l.amount) })),
    credit: {
      limit: customer?.creditLimit ?? null,
      available: customer?.creditLimit ? fmt(Number(customer.creditLimit) - newBalance) : null,
      blocked,
    },
    empties, shortages, businessLine,
  };
}

/* ------------------------------------------------------------- save offline */

/** Saves a bill on this PC. The returned bill is what gets printed and later synced. */
export async function saveSaleOffline(s: Snapshot, b: SaleBody, p: Preview, clientId: string, salesmanName: string | null): Promise<OutboxOp> {
  const prefix = localStorage.getItem(PREFIX_KEY);
  if (!prefix) throw new Error('This PC has no device number yet. Connect once to set it up, then bills can be made offline.');
  const number = nextNumber(p.businessLine === 'BOTTLES' ? 'BTL' : 'RIC', prefix);
  const now = new Date();
  const customer = b.customerId ? s.customers.find((c) => c.id === b.customerId) : undefined;
  const prod = (id: string) => s.products.find((x) => x.id === id)!;
  const bill: BillData = {
    billNo: number, date: now.toISOString(), createdAt: now.toISOString(), status: 'ACTIVE', saleType: b.saleType,
    customer: customer ? { name: customer.name, shopName: customer.shopName, creditLimit: customer.creditLimit } : null,
    salesman: salesmanName ? { name: salesmanName } : null,
    items: b.items.map((l, i) => ({ product: { name: prod(l.productId).name, size: prod(l.productId).size }, unitName: l.unitName, qty: String(l.qty), rate: p.items[i].rate, lineTotal: p.items[i].amount })),
    returns: b.returns.map((l, i) => ({ product: { name: prod(l.productId).name, size: prod(l.productId).size }, unitName: l.unitName, qty: String(l.qty), creditAmount: p.returns[i].amount, reason: l.reason })),
    gross: p.gross, returnsCredit: p.returnsCredit, net: p.net, paidNow: p.paid,
    previousBalance: p.previousBalance, newBalance: p.newBalance, availableCredit: p.credit.available,
    empties: p.empties.length ? p.empties : null,
  };
  const op: OutboxOp = {
    clientId, kind: 'SALE', number, savedAt: now.toISOString(), status: 'pending', attempts: 0,
    sale: { ...b, date: localDay(now), paidNow: Number(p.paid) },
    customerId: b.customerId,
    balanceDelta: b.customerId ? Number(p.net) - Number(p.paid) : 0,
    stockUsed: b.items.map((l) => ({ productId: l.productId, locationId: b.locationId, qtyBase: l.qty * factor(prod(l.productId), l.unitName) })),
    emptiesDelta: p.empties.map((e) => ({ productId: s.products.find((x) => x.name === e.productName)?.id ?? '', qty: e.given - e.collected })),
    bill,
  };
  await putOp(op);
  await recount();
  void syncNow();
  return op;
}

export async function savePaymentOffline(s: Snapshot, body: PaymentBody, clientId: string): Promise<OutboxOp> {
  const prefix = localStorage.getItem(PREFIX_KEY);
  if (!prefix) throw new Error('This PC has no device number yet. Connect once to set it up.');
  const customer = s.customers.find((c) => c.id === body.customerId);
  if (!customer) throw new Error('Unknown or inactive customer');
  const adj = await adjusted(s);
  const before = round2(adj.balance.get(customer.id) ?? 0);
  const now = new Date();
  const number = nextNumber('RCP', prefix);
  const op: OutboxOp = {
    clientId, kind: 'PAYMENT', number, savedAt: now.toISOString(), status: 'pending', attempts: 0,
    payment: { ...body, date: localDay(now) }, customerId: customer.id, balanceDelta: -body.amount, stockUsed: [], emptiesDelta: [],
    receipt: {
      receiptNo: number, createdAt: now.toISOString(), status: 'ACTIVE', customer: { name: customer.name, shopName: customer.shopName },
      amount: String(body.amount), method: body.method ?? 'CASH', previousBalance: fmt(before), newBalance: fmt(before - body.amount),
      recordedBy: getUser()?.username ?? null,
    },
  };
  await putOp(op);
  await recount();
  void syncNow();
  return op;
}

const localDay = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
