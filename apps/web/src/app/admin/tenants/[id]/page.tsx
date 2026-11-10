'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CopyButton, LoginTable, loginLink, Spark } from '@/components/AdminBits';
import { Avatar } from '@/components/Avatar';
import { BusyButton, Empty, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Affix, Field, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { PaymentDrawer } from '@/components/PaymentDrawer';
import { StatTiles } from '@/components/StatTiles';
import { ago, deviceLine, methodLabel, place, platformApi, renewalMessage, rs, stateOf, whatsapp, type LoginEvent, type Payment, type SeenRow, type Tenant } from '@/lib/platform';

interface Detail {
  tenant: Tenant;
  counts: { users: number; customers: number; suppliers: number; products: number; sales: number; purchases: number; employees: number; expenses: number; stockMoves: number };
  lastSaleAt: string | null;
  users: { id: string; username: string; displayName: string | null; isActive: boolean; role: string; lastLoginAt: string | null; logins: number }[];
  usage: { day: string; requests: number; writes: number; errors: number }[];
  modules: { module: string; requests: number }[];
  sessions: SeenRow[];
  logins: LoginEvent[];
  history: { id: string; adminName: string; action: string; detail: Record<string, unknown> | null; createdAt: string }[];
  countries: string[];
}

type Tab = 'overview' | 'people' | 'logins' | 'billing' | 'history' | 'settings';
const TABS: [Tab, string][] = [['overview', 'Overview'], ['people', 'People & devices'], ['logins', 'Sign-ins'], ['billing', 'Billing'], ['history', 'History'], ['settings', 'Settings']];

const ACTIONS: Record<string, string> = {
  CREATE_TENANT: 'Business created', UPDATE_TENANT: 'Details changed', SUSPEND_TENANT: 'Suspended', ACTIVATE_TENANT: 'Let back in', RESET_PASSWORD: 'New password made',
  PAYMENT: 'Payment recorded', UNDO_PAYMENT: 'Payment undone', SIGN_OUT_ALL: 'Everyone signed out', ANNOUNCE: 'Announcement sent',
};

/** What a path name means to the owner. */
const MODULE_NAMES: Record<string, string> = {
  sales: 'Sales and bills', customers: 'Customers', khata: 'Khata and dues', products: 'Products', stock: 'Stock', purchases: 'Purchases', suppliers: 'Suppliers',
  expenses: 'Expenses', reports: 'Reports', dashboard: 'Dashboard', employees: 'Employees', payroll: 'Payroll', trips: 'Vehicle trips', vehicles: 'Vehicles',
  locations: 'Locations', users: 'Users and roles', settings: 'Settings', audit: 'Audit log', sync: 'Offline sync', auth: 'Sign-in and profile', search: 'Search',
  'day-end': 'Day end', collections: 'Collections', cheques: 'Cheques', import: 'Import', roles: 'Roles', 'delivery-proofs': 'Delivery photos', backups: 'Backups',
  attendance: 'Attendance', holidays: 'Holidays', 'expense-categories': 'Expense categories', catalog: 'Catalog', categories: 'Categories', receipts: 'Receipts', 'expense': 'Expenses',
};

export default function TenantPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [now] = useState(() => Date.now());
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [paying, setPaying] = useState(false);
  const [creds, setCreds] = useState<{ username: string; password: string } | null>(null);

  const load = useCallback(() => platformApi<Detail>(`/tenants/${id}`).then((r) => {
    setD(r);
    setError('');
    setEdit((e) => (Object.keys(e).length ? e : {
      name: r.tenant.name, contactName: r.tenant.contactName ?? '', phone: r.tenant.phone ?? '', email: r.tenant.email ?? '', city: r.tenant.city ?? '',
      status: r.tenant.status === 'SUSPENDED' ? 'ACTIVE' : r.tenant.status, expiresAt: r.tenant.expiresAt?.slice(0, 10) ?? '', maxUsers: r.tenant.maxUsers ? String(r.tenant.maxUsers) : '', monthlyFee: r.tenant.monthlyFee ? String(Math.round(Number(r.tenant.monthlyFee))) : '', notes: r.tenant.notes ?? '',
    }));
  }).catch((e) => setError(e.message)), [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);
  const loadPayments = useCallback(() => platformApi<Payment[]>(`/tenants/${id}/payments`).then(setPayments).catch(() => {}), [id]);
  useEffect(() => { loadPayments(); }, [loadPayments]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); toast.success(label); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    await run('Saved', () => platformApi(`/tenants/${id}`, {
      method: 'PATCH',
      json: {
        name: edit.name.trim(), contactName: edit.contactName, phone: edit.phone, email: edit.email, city: edit.city, notes: edit.notes,
        status: d?.tenant.status === 'SUSPENDED' ? undefined : edit.status,
        expiresAt: edit.expiresAt ? new Date(`${edit.expiresAt}T23:59:59`).toISOString() : '',
        maxUsers: edit.maxUsers ? Number(edit.maxUsers) : 0,
        monthlyFee: edit.monthlyFee ? Number(edit.monthlyFee) : 0,
      },
    }));
  }

  async function suspend() {
    if (!d) return;
    const reason = await prompt({ title: `Suspend ${d.tenant.name}?`, body: <p>Nobody from this business can sign in, and anyone already inside is signed out on their next click. Their data is kept.</p>, label: 'Reason (the staff will see it)', confirmLabel: 'Suspend', danger: true });
    if (reason === null) return;
    await run('Suspended', () => platformApi(`/tenants/${id}/suspend`, { method: 'POST', json: { reason } }));
  }

  async function resetOwner() {
    if (!d) return;
    if (!(await confirm({ title: 'Make a new owner password?', body: <p>The old password stops working at once. You will see the new one here to pass on.</p>, confirmLabel: 'Make new password', danger: true }))) return;
    setBusy(true);
    try { setCreds(await platformApi<{ username: string; password: string }>(`/tenants/${id}/reset-owner`, { method: 'POST', json: {} })); await load(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  async function signOutAll() {
    if (!d) return;
    if (!(await confirm({ title: `Sign everyone out of ${d.tenant.name}?`, body: <p>Every phone and computer is signed out on its next click. People sign in again with their own password. Use it after a lost phone or when someone leaves.</p>, confirmLabel: 'Sign everyone out', danger: true }))) return;
    await run('Everyone was signed out', () => platformApi(`/tenants/${id}/sign-out-all`, { method: 'POST', json: {} }));
  }

  async function undoPayment(p: Payment) {
    if (!(await confirm({ title: 'Undo this payment?', body: <p>{rs(p.amount)} is removed and the end date goes back to what it was.</p>, confirmLabel: 'Undo payment', danger: true }))) return;
    await run('Payment removed', async () => { await platformApi(`/payments/${p.id}`, { method: 'DELETE' }); await loadPayments(); });
  }

  async function remove() {
    if (!d) return;
    const typed = await prompt({ title: `Delete ${d.tenant.name} for good?`, body: <p>All of its data (bills, customers, stock, everything) is erased and cannot be brought back. Type the business code <b>{d.tenant.code}</b> to confirm.</p>, label: 'Business code', confirmLabel: 'Delete everything', danger: true });
    if (typed === null) return;
    try {
      await platformApi(`/tenants/${id}`, { method: 'DELETE', json: { confirm: typed.trim() } });
      toast.success('Business deleted');
      router.replace('/admin/tenants');
    } catch (e) { toast.error((e as Error).message); }
  }

  if (error && !d) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton" style={{ height: 220 }} />;
  const t = d.tenant;
  const s = stateOf(t);
  const online = d.sessions.filter((x) => now - new Date(x.lastSeen).getTime() < 15 * 60_000);

  return (
    <>
      <div className="page-head tenant-head">
        <div className="tenant-title">
          <span className="tenant-badge lg">{t.name.slice(0, 1).toUpperCase()}</span>
          <div>
            <h1>{t.name} <span className={`badge ${s.tone}`}>{s.label}</span></h1>
            <p>{t.code}{t.city ? ` · ${t.city}` : ''}{t.contactName ? ` · ${t.contactName}` : ''}{t.phone ? ` · ${t.phone}` : ''}</p>
          </div>
        </div>
        <div className="head-actions">
          {t.phone && <a className="button secondary btn-icon" href={`tel:${t.phone}`}><Icon name="phone" />Call</a>}
          {t.phone && !t.isMain && <a className="button secondary btn-icon" href={whatsapp(t.phone, renewalMessage(t))} target="_blank" rel="noreferrer"><Icon name="message" />WhatsApp</a>}
          <CopyButton text={loginLink(t.code)} label="Copy sign-in link" />
          {!t.isMain && <button type="button" className="btn-icon" onClick={() => setPaying(true)}><Icon name="wallet" />Record payment</button>}
        </div>
      </div>
      {t.blocked && <p className="alert-bar"><Icon name="alert" />{t.blocked}</p>}

      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}{k === 'people' && online.length > 0 ? <span className="tab-dot" /> : null}</button>)}
      </div>

      {tab === 'overview' && (
        <>
          <StatTiles items={[
            { label: 'Users', value: <>{t.activeUsers}{t.maxUsers ? <small> / {t.maxUsers}</small> : null}</>, sub: 'active accounts', icon: 'users' },
            { label: 'Online now', value: online.length ? new Set(online.map((x) => x.username)).size : 0, sub: `last active ${ago(t.lastActiveAt)}`, icon: 'user', tone: online.length ? 'green' : undefined },
            { label: 'Requests (7 d)', value: t.requests7d.toLocaleString(), sub: `${t.requestsToday.toLocaleString()} today`, icon: 'trend' },
            { label: 'Bills made', value: d.counts.sales.toLocaleString(), sub: d.lastSaleAt ? `last one ${ago(d.lastSaleAt)}` : 'none yet', icon: 'sales' },
          ]} />
          <div className="admin-grid">
            <section className="card">
              <div className="card-head"><h3>Use over 30 days</h3><span className="muted">requests per day</span></div>
              <Spark label="Requests per day, last 30 days" data={d.usage.map((u) => ({ key: u.day, value: u.requests, tick: Number(u.day.slice(8)) % 5 === 0 ? u.day.slice(8) : '', note: `${u.day}: ${u.requests} requests, ${u.writes} changes${u.errors ? `, ${u.errors} errors` : ''}` }))} />
              {!d.usage.length && <p className="muted">No activity recorded yet.</p>}
            </section>
            <section className="card">
              <div className="card-head"><h3>What they use</h3><span className="muted">share of requests, 30 days</span></div>
              {!d.modules.length && <p className="muted">Nothing yet.</p>}
              <ul className="list">
                {d.modules.slice(0, 8).map((m) => (
                  <li key={m.module} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{MODULE_NAMES[m.module] ?? m.module}</span><span className="amt">{m.requests.toLocaleString()}</span></span>
                    <span className="meter" aria-hidden="true"><span style={{ width: `${(m.requests / d.modules[0].requests) * 100}%`, background: 'var(--accent)' }} /></span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <section className="card">
            <div className="card-head"><h3>What is inside</h3><span className="muted">records in their system</span></div>
            <dl className="counts">
              {([['Customers', d.counts.customers], ['Suppliers', d.counts.suppliers], ['Products', d.counts.products], ['Bills', d.counts.sales], ['Purchases', d.counts.purchases], ['Employees', d.counts.employees], ['Expenses', d.counts.expenses], ['Stock movements', d.counts.stockMoves]] as [string, number][]).map(([l, v]) => (
                <div key={l}><dt>{l}</dt><dd>{v.toLocaleString()}</dd></div>
              ))}
            </dl>
          </section>
        </>
      )}

      {tab === 'people' && (
        <>
          <div className="section-head"><h2>Accounts</h2><span className="count-pill">{d.users.length}</span></div>
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="num">Sign-ins</th></tr></thead>
            <tbody>
              {d.users.map((u) => (
                <tr key={u.id} className={u.isActive ? '' : 'inactive'}>
                  <td><span className="person"><Avatar user={{ username: u.displayName || u.username }} size={28} /><b>{u.displayName || u.username}</b>{u.displayName && <span className="muted">@{u.username}</span>}</span></td>
                  <td><span className="badge blue">{u.role}</span></td>
                  <td>{u.isActive ? <span className="badge green">Active</span> : <span className="badge">Turned off</span>}</td>
                  <td className="muted">{ago(u.lastLoginAt)}</td>
                  <td className="num">{u.logins}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="section-head"><h2>Devices and places</h2><span className="count-pill">{d.sessions.length}</span>{d.countries.length > 1 && <span className="badge amber" title="Seen from more than one country">{d.countries.join(' · ')}</span>}</div>
          <p className="muted" style={{ marginTop: -4 }}>Each row is one person on one device from one address. The place is the host&apos;s best guess from the address.</p>
          <table>
            <thead><tr><th>Person</th><th>Device</th><th>Place</th><th>Address</th><th>First seen</th><th>Last seen</th><th className="num">Requests</th></tr></thead>
            <tbody>
              {d.sessions.map((r) => {
                const live = now - new Date(r.lastSeen).getTime() < 15 * 60_000;
                return (
                  <tr key={r.id}>
                    <td><b>{r.username}</b></td>
                    <td>{deviceLine(r)}</td>
                    <td>{place(r)}</td>
                    <td className="mono">{r.ip ?? '—'}</td>
                    <td className="muted">{ago(r.firstSeen)}</td>
                    <td>{live ? <span className="badge green"><i className="live-dot" />Online</span> : <span className="muted">{ago(r.lastSeen)}</span>}</td>
                    <td className="num">{r.hits.toLocaleString()}</td>
                  </tr>
                );
              })}
              {!d.sessions.length && <tr><td colSpan={7}><Empty icon="phone" title="Nobody has used it yet" text="Devices appear here after the first sign-in." /></td></tr>}
            </tbody>
          </table>
        </>
      )}

      {tab === 'logins' && (
        <>
          <div className="section-head"><h2>Recent sign-ins</h2><Link className="muted" href={`/admin/activity?tab=log&tenantId=${t.id}`}>See the full log</Link></div>
          <LoginTable rows={d.logins} />
        </>
      )}

      {tab === 'billing' && (
        <>
          <StatTiles items={[
            { label: 'Monthly fee', value: t.monthlyFee ? rs(t.monthlyFee) : 'Not set', sub: t.monthlyFee ? undefined : 'set it under Settings', icon: 'wallet' },
            { label: 'Access ends', value: t.expiresAt ? new Date(t.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Never', sub: t.expiresAt ? (t.daysLeft ?? 0) < 0 ? `ended ${Math.abs(t.daysLeft ?? 0)} d ago` : `${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'} left` : 'no end date', icon: 'history', tone: t.expiresAt && (t.daysLeft ?? 99) <= 7 ? ((t.daysLeft ?? 0) < 0 ? 'red' : 'amber') : 'green' },
            { label: 'Paid so far', value: rs((payments ?? []).reduce((x, p) => x + Number(p.amount), 0)), sub: `${payments?.length ?? 0} payment${payments?.length === 1 ? '' : 's'}`, icon: 'check', tone: 'green' },
            { label: 'Last payment', value: payments?.[0] ? new Date(payments[0].paidOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—', sub: payments?.[0] ? rs(payments[0].amount) : 'none yet', icon: 'trend' },
          ]} />
          <div className="section-head"><h2>Payments</h2>{!t.isMain && <button type="button" className="btn-icon" onClick={() => setPaying(true)}><Icon name="plus" />Record payment</button>}</div>
          <table>
            <thead><tr><th>Received</th><th className="num">Amount</th><th>Method</th><th>Covers</th><th>Note</th><th>By</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {payments?.map((p, i) => (
                <tr key={p.id}>
                  <td className="nowrap">{new Date(p.paidOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                  <td className="num"><b>{rs(p.amount)}</b></td>
                  <td><span className="badge blue">{methodLabel(p.method)}</span></td>
                  <td className="muted">{p.months} month{p.months === 1 ? '' : 's'}</td>
                  <td className="muted">{p.note}</td>
                  <td className="muted">{p.createdByName}</td>
                  <td>{i === 0 && <button type="button" className="secondary icon-only danger-hover" title="Undo this payment" aria-label="Undo this payment" onClick={() => void undoPayment(p)}><Icon name="ban" /></button>}</td>
                </tr>
              ))}
              {payments && !payments.length && <tr><td colSpan={7}><Empty icon="wallet" title={t.isMain ? 'Your own business does not pay' : 'No payments yet'} text={t.isMain ? undefined : 'Record one when they pay; the access end date moves forward by itself.'} /></td></tr>}
            </tbody>
          </table>
        </>
      )}

      {tab === 'history' && (
        <>
          <div className="section-head"><h2>What was done to this business</h2><span className="count-pill">{d.history.length}</span></div>
          <ul className="timeline">
            {d.history.map((h) => (
              <li key={h.id}>
                <span className="timeline-dot" aria-hidden="true" />
                <span className="timeline-main">
                  <b>{ACTIONS[h.action] ?? h.action}</b>
                  <small>
                    by {h.adminName} · {ago(h.createdAt)}
                    {h.detail && typeof h.detail.reason === 'string' && h.detail.reason ? ` · “${h.detail.reason}”` : ''}
                    {h.detail && typeof h.detail.amount !== 'undefined' ? ` · ${rs(h.detail.amount as number)}` : ''}
                    {h.detail && typeof h.detail.until === 'string' ? ` · until ${h.detail.until}` : ''}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          {!d.history.length && <Empty icon="history" title="Nothing yet" text="Changes made in this console show up here." />}
        </>
      )}

      {tab === 'settings' && (
        <div className="admin-settings">
          <form className="card" onSubmit={save}>
            <div className="card-head"><h3>Details and plan</h3></div>
            <div className="form-grid">
              <FormSection>
                <Field label="Business name" required span={12}><input required value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
                <Field label="Contact person" optional span={6}><input value={edit.contactName ?? ''} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
                <Field label="Phone" optional span={6}><input type="tel" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
                <Field label="Email" optional span={6}><input type="email" value={edit.email ?? ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
                <Field label="City" optional span={6}><input value={edit.city ?? ''} onChange={(e) => setEdit({ ...edit, city: e.target.value })} /></Field>
                {t.status !== 'SUSPENDED' && !t.isMain && (
                  <Field label="Plan" span={6}>
                    <select value={edit.status ?? 'TRIAL'} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="TRIAL">Trial</option><option value="ACTIVE">Active (paying)</option></select>
                  </Field>
                )}
                <Field label="Access ends on" optional span={6} hint="Empty = never."><input type="date" value={edit.expiresAt ?? ''} onChange={(e) => setEdit({ ...edit, expiresAt: e.target.value })} /></Field>
                <Field label="Most active users" optional span={6} hint="Empty = no limit."><Affix suffix="users"><input type="number" min={1} max={500} value={edit.maxUsers ?? ''} onChange={(e) => setEdit({ ...edit, maxUsers: e.target.value })} /></Affix></Field>
                <Field label="Monthly fee" optional span={6} hint="Used for your income figures. Empty = not set."><Affix prefix="Rs"><input type="number" min={0} step="any" inputMode="decimal" value={edit.monthlyFee ?? ''} onChange={(e) => setEdit({ ...edit, monthlyFee: e.target.value })} /></Affix></Field>
                <Field label="Notes" optional span={12}><textarea rows={3} maxLength={1000} value={edit.notes ?? ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
              </FormSection>
            </div>
            <div className="form-actions"><BusyButton busy={busy}><Icon name="check" />Save changes</BusyButton></div>
          </form>

          <div className="admin-side">
            <section className="card">
              <div className="card-head"><h3>Sign-in details</h3></div>
              <dl className="cred compact">
                <div><dt>Sign-in page</dt><dd>{loginLink(t.code)}</dd></div>
                <div><dt>Business code</dt><dd>{t.code}</dd></div>
              </dl>
              <div className="btn-row"><CopyButton text={loginLink(t.code)} label="Copy link" /><button type="button" className="secondary btn-icon" disabled={busy} onClick={resetOwner}><Icon name="lock" />New owner password</button></div>
              {creds && (
                <div className="creds-note pop">
                  <b>New password for {creds.username}</b>
                  <code>{creds.password}</code>
                  <CopyButton text={`Username: ${creds.username}\nPassword: ${creds.password}`} />
                </div>
              )}
            </section>

            <section className="card">
              <div className="card-head"><h3>Security</h3></div>
              <p className="muted">Lost phone, or someone left? End every sign-in of this business at once.</p>
              <div className="btn-row">
                <button type="button" className="secondary btn-icon" disabled={busy} onClick={signOutAll}><Icon name="logout" />Sign everyone out</button>
                <Link className="button secondary btn-icon" href={`/admin/announcements?tenantId=${t.id}`}><Icon name="message" />Send a message</Link>
              </div>
            </section>

            {!t.isMain && (
              <section className="card danger-zone">
                <div className="card-head"><h3>Access</h3></div>
                {t.status === 'SUSPENDED'
                  ? <><p className="muted">Suspended{t.suspendedReason ? `: ${t.suspendedReason}` : ''}. Nobody can sign in.</p><BusyButton busy={busy} onClick={() => run('Activated again', () => platformApi(`/tenants/${id}/activate`, { method: 'POST', json: {} }))}><Icon name="check" />Let them back in</BusyButton></>
                  : <><p className="muted">Stop everyone from signing in, for example when a payment is missing. Their data is kept.</p><button type="button" className="secondary danger-hover btn-icon" disabled={busy} onClick={suspend}><Icon name="ban" />Suspend access</button></>}
                <hr />
                <p className="muted">Erase this business and everything in it. This cannot be undone.</p>
                <button type="button" className="danger btn-icon" onClick={remove}><Icon name="x" />Delete business</button>
              </section>
            )}
          </div>
        </div>
      )}
      {paying && <PaymentDrawer tenant={{ id: t.id, name: t.name, monthlyFee: t.monthlyFee, expiresAt: t.expiresAt }} onClose={() => setPaying(false)} onDone={() => { setPaying(false); void load(); void loadPayments(); }} />}
    </>
  );
}
