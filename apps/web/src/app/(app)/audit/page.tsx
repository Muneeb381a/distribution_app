'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { downloadCsv } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';

interface Entry {
  id: string; at: string; action: string; entity: string; entityId: string | null; userId: string | null;
  beforeJson: unknown; afterJson: unknown; user: { username: string } | null;
}

const PAGE = 100;
const ENTITIES: [string, string][] = [
  ['Sale', 'Bills'], ['Payment', 'Receipts'], ['Customer', 'Customers'], ['Product', 'Products'], ['Purchase', 'Purchases'],
  ['PurchaseReturn', 'Purchase returns'], ['SupplierPayment', 'Supplier payments'], ['Supplier', 'Suppliers'], ['SupplierEmpties', 'Supplier empties'],
  ['StockTransfer', 'Stock transfers'], ['StockAdjustment', 'Stock adjustments'], ['Expense', 'Expenses'], ['PayrollRun', 'Payroll'],
  ['SalaryAdvance', 'Advances'], ['Attendance', 'Attendance'], ['Employee', 'Employees'], ['Location', 'Locations'], ['Category', 'Categories'],
  ['AppUser', 'Users'], ['Role', 'Roles'],
];
const ONE: Record<string, string> = {
  Sale: 'Bill', Payment: 'Receipt', Customer: 'Customer', Product: 'Product', Purchase: 'Purchase', PurchaseReturn: 'Purchase return',
  SupplierPayment: 'Supplier payment', Supplier: 'Supplier', SupplierEmpties: 'Supplier empties', StockTransfer: 'Stock transfer',
  StockAdjustment: 'Stock adjustment', Expense: 'Expense', PayrollRun: 'Payroll', SalaryAdvance: 'Advance', Attendance: 'Attendance',
  Employee: 'Employee', Location: 'Location', Category: 'Category', AppUser: 'User', Role: 'Role',
};
const ACTIONS: Record<string, [string, string]> = {
  CREATE: ['Created', 'green'], UPDATE: ['Changed', 'blue'], CANCEL: ['Cancelled', 'red'], RUN: ['Finalised', 'teal'],
  SET_PRICES: ['Prices set', 'blue'], credit_override: ['Credit override', 'amber'], CREDIT_OVERRIDE: ['Credit override', 'amber'], LOGIN: ['Signed in', ''], SET_RATES: ['Rates set', 'blue'], ATTENDANCE: ['Attendance', ''], IMPORT: ['Imported', 'amber'],
};
const HREF: Record<string, (id: string) => string> = {
  Sale: (id) => `/sales/${id}`, Payment: (id) => `/receipts/${id}`, Customer: (id) => `/customers/${id}`, Supplier: (id) => `/suppliers/${id}`,
  PayrollRun: (id) => `/payroll/${id}`, Product: () => '/products', Location: () => '/locations', Employee: () => '/employees', Expense: () => '/expenses',
};
// Fields that only add noise to a diff.
const HIDDEN = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash', 'createdById', 'cancelledById']);

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const addDays = (d: Date, k: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
type Preset = '7d' | '30d' | 'month' | 'all' | 'custom';
function rangeOf(p: Preset): [string, string] {
  const t = new Date();
  if (p === '7d') return [iso(addDays(t, -6)), iso(t)];
  if (p === '30d') return [iso(addDays(t, -29)), iso(t)];
  if (p === 'month') return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(t)];
  return ['', ''];
}

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}T/.test(v) ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length ? `${v.length} item${v.length === 1 ? '' : 's'}` : 'none';
  return JSON.stringify(v);
}
/** Short human name for the record ("BTL-000012", "Ali Store"). */
function nameOf(e: Entry): string {
  const o = asObj(e.afterJson) ?? asObj(e.beforeJson);
  const v = o && (o.billNo ?? o.receiptNo ?? o.purchaseNo ?? o.name ?? o.username ?? o.category ?? o.month);
  return typeof v === 'string' ? v : '';
}

/** One line per item of a list (prices, rates, lines): "CARTON · rate 1350". */
function itemLine(v: unknown): string {
  const o = asObj(v);
  if (!o) return show(v);
  const parts = ['unitName', 'rate', 'qty', 'amount', 'status', 'name'].filter((k) => o[k] !== undefined && o[k] !== null).map((k) => (k === 'unitName' || k === 'name' ? String(o[k]).toLowerCase() : `${k} ${show(o[k])}`));
  return parts.join(' · ') || JSON.stringify(o);
}

function ListDiff({ before, after }: { before: unknown[] | null; after: unknown[] | null }) {
  const a = (before ?? []).map(itemLine), b = (after ?? []).map(itemLine);
  return (
    <div className="diff" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <div className="hd">Before</div><div className="hd">After</div>
      <div className={before ? 'old' : 'same'}>{a.length ? a.map((x, i) => <div key={i}>{x}</div>) : '—'}</div>
      <div className={after ? 'new' : 'same'}>{b.length ? b.map((x, i) => <div key={i}>{x}</div>) : '—'}</div>
    </div>
  );
}

function Diff({ e, onlyChanged }: { e: Entry; onlyChanged: boolean }) {
  if (Array.isArray(e.beforeJson) || Array.isArray(e.afterJson)) {
    return <ListDiff before={Array.isArray(e.beforeJson) ? e.beforeJson : null} after={Array.isArray(e.afterJson) ? e.afterJson : null} />;
  }
  const before = asObj(e.beforeJson), after = asObj(e.afterJson);
  if (!before && !after) return <p className="muted" style={{ margin: 0 }}>No details were recorded for this action.</p>;
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => !HIDDEN.has(k));
  const rows = keys.map((k) => ({ k, a: before?.[k], b: after?.[k], changed: JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]) }));
  const list = before && after && onlyChanged ? rows.filter((r) => r.changed) : rows;
  if (!list.length) return <p className="muted" style={{ margin: 0 }}>Saved with no field changes.</p>;
  return (
    <div className="diff">
      <div className="hd">Field</div><div className="hd">{before ? 'Before' : ''}</div><div className="hd">{after ? 'After' : ''}</div>
      {list.map((r) => (
        <Fragment key={r.k}>
          <div className="k">{r.k}</div>
          <div className={before ? (r.changed && after ? 'old' : 'same') : ''}>{before ? show(r.a) : ''}</div>
          <div className={after ? (r.changed && before ? 'new' : 'same') : ''}>{after ? show(r.b) : ''}</div>
        </Fragment>
      ))}
    </div>
  );
}

export default function AuditPage() {
  const me = useUser();
  const toast = useToast();
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [users, setUsers] = useState<{ id: string; username: string }[]>([]);
  const [preset, setPreset] = useState<Preset>('7d');
  const [[from, to], setRange] = useState<[string, string]>(() => rangeOf('7d'));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyChanged, setOnlyChanged] = useState(true);
  const [error, setError] = useState('');

  const query = useCallback((before?: string) => {
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (entity) qs.set('entity', entity);
    if (action) qs.set('action', action);
    if (userId) qs.set('userId', userId);
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (before) qs.set('before', before);
    return api<Entry[]>(`/audit-log?${qs}`);
  }, [entity, action, userId, from, to]);

  useEffect(() => {
    let stale = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null);
    query()
      .then((r) => { if (!stale) { setRows(r); setMore(r.length === PAGE); setError(''); } })
      .catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [query]);

  // The user filter lists everyone when we may read users; otherwise whoever appears in the log.
  useEffect(() => {
    if (can(me, 'USER_MANAGE')) api<{ id: string; username: string }[]>('/users').then(setUsers).catch(() => {});
  }, [me]);
  const userOptions = useMemo(() => {
    const m = new Map(users.map((u) => [u.id, u.username]));
    for (const r of rows ?? []) if (r.userId && r.user) m.set(r.userId, r.user.username);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [users, rows]);

  async function loadMore() {
    if (!rows?.length) return;
    setBusy(true);
    try {
      const r = await query(rows[rows.length - 1].at);
      setRows([...rows, ...r]);
      setMore(r.length === PAGE);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const choose = (p: Preset) => { setPreset(p); setRange(rangeOf(p)); };

  // Group by day for scanning.
  const days = useMemo(() => {
    const out: { day: string; items: Entry[] }[] = [];
    for (const r of rows ?? []) {
      const d = iso(new Date(r.at));
      if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(r);
    }
    return out;
  }, [rows]);
  const dayLabel = (d: string) => {
    const t = iso(new Date());
    if (d === t) return 'Today';
    if (d === iso(addDays(new Date(), -1))) return 'Yesterday';
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  function exportCsv() {
    downloadCsv(`audit-${from || 'all'}_${to || 'now'}.csv`, ['Time', 'User', 'Action', 'Record', 'Name', 'Record id', 'Before', 'After'],
      (rows ?? []).map((r) => [new Date(r.at).toISOString(), r.user?.username ?? 'system', r.action, r.entity, nameOf(r), r.entityId, r.beforeJson ? JSON.stringify(r.beforeJson) : '', r.afterJson ? JSON.stringify(r.afterJson) : '']));
  }

  const filtered = !!(entity || action || userId);

  return (
    <>
      <div className="page-head">
        <div><h1>Audit log</h1><p>Every change, who made it and when. Entries cannot be edited or deleted.</p></div>
        <button className="secondary btn-icon" onClick={exportCsv} disabled={!rows?.length}><Icon name="download" />Export CSV</button>
      </div>

      <div className="filters">
        <div className="chips">
          {([['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['all', 'All time']] as [Preset, string][]).map(([p, l]) => (
            <button key={p} type="button" className={`chip${preset === p ? ' on' : ''}`} aria-pressed={preset === p} onClick={() => choose(p)}>{l}</button>
          ))}
        </div>
        <div className="date-range">
          <input type="date" aria-label="From" value={from} max={to || undefined} onChange={(e) => { setPreset('custom'); setRange([e.target.value, to]); }} />
          <span className="muted">to</span>
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => { setPreset('custom'); setRange([from, e.target.value]); }} />
        </div>
      </div>
      <div className="list-head">
        <select aria-label="Record type" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All records</option>
          {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {Object.entries(ACTIONS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="User" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">All users</option>
          {userOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {filtered && <button type="button" className="secondary" onClick={() => { setEntity(''); setAction(''); setUserId(''); }}>Clear filters</button>}
        <span className="grow" />
        <label className="toolbar" style={{ margin: 0 }}><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only changed fields</label>
      </div>

      {error && <p className="error">{error}</p>}

      <table className="sticky-head audit-table">
        <thead><tr><th style={{ width: 90 }}>Time</th><th>User</th><th>Action</th><th>Record</th><th><span className="sr-only">Details</span></th></tr></thead>
        <tbody>
          {!rows && !error && <SkeletonRows cols={5} rows={8} />}
          {days.map(({ day, items }) => (
            <Fragment key={day}>
              <tr className="day-row"><td colSpan={5}>{dayLabel(day)} <span className="muted">· {items.length}{items.length === PAGE ? '+' : ''} entries</span></td></tr>
              {items.map((e) => {
                const [label, tone] = ACTIONS[e.action] ?? [e.action.toLowerCase(), ''];
                const href = e.entityId && HREF[e.entity]?.(e.entityId);
                const isOpen = open.has(e.id);
                const name = nameOf(e);
                return (
                  <Fragment key={e.id}>
                    <tr className={`row-link${isOpen ? ' open' : ''}`} tabIndex={0} aria-expanded={isOpen}
                      onClick={(ev) => { if (!(ev.target as HTMLElement).closest('a')) toggle(e.id); }}
                      onKeyDown={(ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); toggle(e.id); } }}>
                      <td className="muted">{new Date(e.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <span className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>{(e.user?.username ?? 'sy').slice(0, 2)}</span>
                          <span className="uname">{e.user?.username ?? <span className="muted">system</span>}</span>
                        </span>
                      </td>
                      <td><span className={`badge ${tone}`}>{label}</span></td>
                      <td>
                        <b>{ONE[e.entity] ?? e.entity}</b>
                        {name && <> · {href ? <Link href={href}>{name}</Link> : name}</>}
                        {!name && href && <> · <Link href={href}>open</Link></>}
                      </td>
                      <td className="num"><span className="chev" aria-hidden="true"><Icon name={isOpen ? 'chevronDown' : 'chevronRight'} /></span></td>
                    </tr>
                    {isOpen && (
                      <tr className="detail-row"><td colSpan={5}><Diff e={e} onlyChanged={onlyChanged} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
          {rows && !rows.length && (
            <tr><td colSpan={5}><Empty icon="history" title="Nothing recorded" text={filtered || from ? 'Try clearing the filters or a longer date range.' : 'Changes show here as people use the app.'} /></td></tr>
          )}
        </tbody>
      </table>
      {more && (
        <div className="load-more">
          <span className="muted">Showing {rows?.length ?? 0} entries</span>
          <BusyButton className="secondary" busy={busy} onClick={loadMore}>Load older entries</BusyButton>
        </div>
      )}
    </>
  );
}
