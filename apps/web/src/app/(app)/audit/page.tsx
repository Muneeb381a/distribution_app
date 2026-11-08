'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { BusyButton, Empty, useToast } from '@/components/Feedback';
import { Icon, type IconName } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { downloadCsv } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';
import { addDays, localDay, presetRange } from '@dist/shared';

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
  ['AppUser', 'Users'], ['Role', 'Roles'], ['Holiday', 'Holidays'], ['Device', 'Devices'], ['DayClose', 'Day end'], ['Backup', 'Backups'],
];
const ONE: Record<string, string> = {
  Sale: 'Bill', Payment: 'Receipt', Customer: 'Customer', Product: 'Product', Purchase: 'Purchase', PurchaseReturn: 'Purchase return',
  SupplierPayment: 'Supplier payment', Supplier: 'Supplier', SupplierEmpties: 'Supplier empties', StockTransfer: 'Stock transfer',
  StockAdjustment: 'Stock adjustment', Expense: 'Expense', PayrollRun: 'Payroll', SalaryAdvance: 'Advance', Attendance: 'Attendance',
  Employee: 'Employee', Location: 'Location', Category: 'Category', AppUser: 'User', Role: 'Role', Holiday: 'Holiday', Device: 'Device', DayClose: 'Day end', Backup: 'Backup',
};
const ACTIONS: Record<string, [string, string, IconName]> = {
  CREATE: ['Created', 'green', 'plus'], UPDATE: ['Changed', 'blue', 'edit'], CANCEL: ['Cancelled', 'red', 'ban'], RUN: ['Finalised', 'teal', 'check'],
  SET_PRICES: ['Prices set', 'blue', 'trend'], SET_RATES: ['Rates set', 'blue', 'trend'], credit_override: ['Credit override', 'amber', 'alert'], CREDIT_OVERRIDE: ['Credit override', 'amber', 'alert'],
  LOGIN: ['Signed in', '', 'user'], ATTENDANCE: ['Attendance', '', 'employees'], IMPORT: ['Imported', 'amber', 'import'], DELIVER: ['Delivered', 'green', 'check'],
  HOLIDAY_ADD: ['Holiday added', 'green', 'history'], HOLIDAY_REMOVE: ['Holiday removed', 'red', 'history'], WEEKLY_OFF: ['Weekly off set', 'blue', 'history'],
  PROOF_ADD: ['Photo added', 'green', 'camera'], PROOF_REMOVE: ['Photo removed', 'red', 'camera'],
  BACKUP: ['Backed up', 'green', 'cloud'], BACKUP_AUTO: ['Backed up (automatic)', 'green', 'cloud'], BACKUP_DOWNLOAD: ['Backup downloaded', 'amber', 'download'],
  DAY_CLOSE: ['Day closed', 'green', 'check'], DAY_REOPEN_RECLOSE: ['Day count changed', 'amber', 'edit'], REMIND: ['Reminded', 'blue', 'message'],
  UPDATE_PASSWORD: ['Password changed', 'amber', 'lock'], STOCK_MARK_DAMAGED: ['Marked damaged', 'red', 'ban'],
};
const HREF: Record<string, (id: string) => string> = {
  Sale: (id) => `/sales/${id}`, Payment: (id) => `/receipts/${id}`, Customer: (id) => `/customers/${id}`, Supplier: (id) => `/suppliers/${id}`,
  PayrollRun: (id) => `/payroll/${id}`, Product: () => '/products', Location: () => '/locations', Employee: () => '/employees', Expense: () => '/expenses',
};
// Fields that only add noise to a diff.
const HIDDEN = new Set(['id', 'createdAt', 'updatedAt', 'passwordHash', 'createdById', 'cancelledById']);

type Preset = '7d' | '30d' | 'month' | 'all' | 'custom';
const rangeOf = (p: Preset): [string, string] => presetRange(p === 'custom' ? 'all' : p);

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

/** "price 120 → 130 · name Coke → Cola +1 more" for a changed record. */
function changeSummary(e: Entry): string {
  const before = asObj(e.beforeJson), after = asObj(e.afterJson);
  if (!before || !after) return '';
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (!changed.length) return '';
  const first = changed.slice(0, 2).map((k) => `${k} ${show(before[k])} → ${show(after[k])}`).join(' · ');
  return changed.length > 2 ? `${first} · +${changed.length - 2} more` : first;
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

  const dayLabel = (d: string) => {
    const t = localDay(new Date());
    if (d === t) return 'Today';
    if (d === localDay(addDays(new Date(), -1))) return 'Yesterday';
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  function exportCsv() {
    downloadCsv(`audit-${from || 'all'}_${to || 'now'}.csv`, ['Time', 'User', 'Action', 'Record', 'Name', 'Record id', 'Before', 'After'],
      (rows ?? []).map((r) => [new Date(r.at).toISOString(), r.user?.username ?? 'system', r.action, r.entity, nameOf(r), r.entityId, r.beforeJson ? JSON.stringify(r.beforeJson) : '', r.afterJson ? JSON.stringify(r.afterJson) : '']));
  }

  const filtered = !!(entity || action || userId);
  const [search, setSearch] = useState('');
  const quick = entity === 'PayrollRun' ? 'payroll' : entity === 'AppUser' ? 'users' : action === 'CANCEL' ? 'cancel' : action === 'CREDIT_OVERRIDE' ? 'credit' : filtered ? 'custom' : 'all';
  const QUICK: [string, string, { entity: string; action: string }][] = [
    ['all', 'Everything', { entity: '', action: '' }],
    ['cancel', 'Cancellations', { entity: '', action: 'CANCEL' }],
    ['credit', 'Credit overrides', { entity: '', action: 'CREDIT_OVERRIDE' }],
    ['payroll', 'Payroll', { entity: 'PayrollRun', action: '' }],
    ['users', 'Users', { entity: 'AppUser', action: '' }],
  ];

  const text = search.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter((r) => !text || `${r.user?.username ?? 'system'} ${ONE[r.entity] ?? r.entity} ${nameOf(r)} ${(ACTIONS[r.action] ?? [r.action])[0]}`.toLowerCase().includes(text)), [rows, text]);
  const shownDays = useMemo(() => {
    const out: { day: string; items: Entry[] }[] = [];
    for (const r of shown) {
      const d = localDay(new Date(r.at));
      if (out[out.length - 1]?.day !== d) out.push({ day: d, items: [] });
      out[out.length - 1].items.push(r);
    }
    return out;
  }, [shown]);
  const stats = useMemo(() => {
    const list = rows ?? [];
    return {
      people: new Set(list.map((r) => r.userId ?? 'system')).size,
      made: list.filter((r) => r.action === 'CREATE' || r.action === 'UPDATE').length,
      cancelled: list.filter((r) => r.action === 'CANCEL').length,
      credit: list.filter((r) => r.action === 'CREDIT_OVERRIDE' || r.action === 'credit_override').length,
    };
  }, [rows]);

  return (
    <>
      <div className="page-head">
        <div><h1>Audit log</h1><p>Every change, who made it and when. Entries cannot be edited or deleted.</p></div>
        <button className="secondary btn-icon" onClick={exportCsv} disabled={!rows?.length}><Icon name="download" />Export CSV</button>
      </div>

      <StatTiles items={[
        { label: 'Entries', value: rows ? `${rows.length}${more ? '+' : ''}` : '…', sub: from ? `${from} to ${to || 'now'}` : 'all time', icon: 'history' },
        { label: 'People active', value: rows ? stats.people : '…', sub: 'who made changes', icon: 'users' },
        { label: 'Cancellations', value: rows ? stats.cancelled : '…', sub: stats.cancelled ? 'bills, receipts, purchases…' : 'none in this period', icon: 'ban', tone: stats.cancelled ? 'red' : 'green' },
        { label: 'Credit overrides', value: rows ? stats.credit : '…', sub: stats.credit ? 'sold over the credit limit' : 'none in this period', icon: 'alert', tone: stats.credit ? 'amber' : 'green' },
      ]} />

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
        <div className="filter"><Icon name="search" /><input aria-label="Search the log" placeholder="Search person, record or action…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="chips" role="group" aria-label="Quick filters">
          {QUICK.map(([k, l, f]) => <button key={k} type="button" className={`chip${quick === k ? ' on' : ''}`} data-tone={k === 'cancel' ? 'red' : k === 'credit' ? 'amber' : undefined} aria-pressed={quick === k} onClick={() => { setEntity(f.entity); setAction(f.action); }}>{l}</button>)}
        </div>
      </div>
      <div className="list-head">
        <select aria-label="Record type" value={entity} onChange={(e) => setEntity(e.target.value)}>
          <option value="">All records</option>
          {ENTITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {Object.entries(ACTIONS).filter(([v]) => v !== 'credit_override').map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
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
      {!rows && !error && <div className="au-skel">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="skeleton" style={{ height: 64 }} />)}</div>}

      {shownDays.map(({ day, items }) => (
        <section key={day} className="au-day">
          <h2 className="au-day-head">{dayLabel(day)}<span className="count-pill">{items.length}</span></h2>
          <ol className="au-list">
            {items.map((e) => {
              const [label, tone, icon] = ACTIONS[e.action] ?? [e.action.toLowerCase().replace(/_/g, ' '), '', 'file'];
              const href = e.entityId && HREF[e.entity]?.(e.entityId);
              const isOpen = open.has(e.id);
              const name = nameOf(e);
              const who = e.user?.username ?? 'system';
              const sum = e.action === 'UPDATE' ? changeSummary(e) : '';
              return (
                <li key={e.id} className={`au-item${isOpen ? ' open' : ''}`}>
                  <button type="button" className="au-row" aria-expanded={isOpen} onClick={() => toggle(e.id)}>
                    <span className={`au-icon ${tone}`}><Icon name={icon} /></span>
                    <span className="au-text">
                      <span className="au-line"><b>{who}</b> <span className={`au-verb ${tone}`}>{label.toLowerCase()}</span> {(ONE[e.entity] ?? e.entity).toLowerCase()}{name && <> <b className="au-name">{name}</b></>}</span>
                      {sum && <span className="au-sum">{sum}</span>}
                    </span>
                    <span className="au-time">{new Date(e.at).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}</span>
                    <span className="chev" aria-hidden="true"><Icon name={isOpen ? 'chevronDown' : 'chevronRight'} /></span>
                  </button>
                  {isOpen && (
                    <div className="au-detail">
                      <div className="au-meta">
                        <span className="person"><Avatar user={{ username: who }} size={24} /><b>{who}</b></span>
                        <span className="muted">{new Date(e.at).toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'medium' })}</span>
                        {href && <Link href={href} className="au-open">Open record<Icon name="chevronRight" /></Link>}
                      </div>
                      <Diff e={e} onlyChanged={onlyChanged} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {rows && !shown.length && (
        <Empty icon="history" title="Nothing recorded" text={filtered || from || text ? 'Try clearing the search or filters, or a longer date range.' : 'Changes show here as people use the app.'} />
      )}
      {more && (
        <div className="load-more">
          <span className="muted">Showing {rows?.length ?? 0} entries</span>
          <BusyButton className="secondary" busy={busy} onClick={loadMore}>Load older entries</BusyButton>
        </div>
      )}
    </>
  );
}
