'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { Affix, Choice, Field, FormSection } from '@/components/Form';
import { CopyButton, loginLink } from '@/components/AdminBits';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { downloadCsv } from '@/components/Table';
import { ago, bytes, platformApi, renewalMessage, rs, stateOf, whatsapp, type Tenant } from '@/lib/platform';

type Filter = 'all' | 'active' | 'trial' | 'attention' | 'suspended';

const EMPTY = { name: '', code: '', contactName: '', phone: '', email: '', city: '', status: 'TRIAL', expiresAt: '', maxUsers: '', monthlyFee: '', notes: '', ownerPassword: '' };

/** A readable code from a name, the same way the server makes one. */
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 26);

export default function TenantsPage() {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState<Tenant[] | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [drawer, setDrawer] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [made, setMade] = useState<{ tenant: Tenant; owner: { username: string; password: string } } | null>(null);

  const load = () => platformApi<Tenant[]>('/tenants').then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => {
    platformApi<{ perTenant: { tenantId: string; bytes: number }[] }>('/storage').then((s) => setSizes(Object.fromEntries(s.perTenant.map((p) => [p.tenantId, p.bytes])))).catch(() => {});
    load();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get('new')) setDrawer(true);
  }, []);

  const shown = useMemo(() => (rows ?? []).filter((t) => {
    const s = stateOf(t);
    if (filter === 'active' && !(s.label === 'Active')) return false;
    if (filter === 'trial' && t.status !== 'TRIAL') return false;
    if (filter === 'suspended' && t.status !== 'SUSPENDED') return false;
    if (filter === 'attention' && !(s.tone === 'red' || s.tone === 'amber')) return false;
    const needle = q.trim().toLowerCase();
    return !needle || [t.name, t.code, t.contactName, t.phone, t.city, t.email].some((x) => x?.toLowerCase().includes(needle));
  }), [rows, q, filter]);

  const count = (fn: (t: Tenant) => boolean) => (rows ?? []).filter(fn).length;
  const code = f.code || slug(f.name);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await platformApi<{ tenant: Tenant; owner: { username: string; password: string } }>('/tenants', {
        method: 'POST',
        json: {
          name: f.name.trim(), code: f.code || undefined, contactName: f.contactName || undefined, phone: f.phone || undefined, email: f.email || undefined,
          city: f.city || undefined, status: f.status, expiresAt: f.expiresAt ? new Date(`${f.expiresAt}T23:59:59`).toISOString() : undefined,
          maxUsers: f.maxUsers ? Number(f.maxUsers) : undefined, monthlyFee: f.monthlyFee ? Number(f.monthlyFee) : undefined, notes: f.notes || undefined, ownerPassword: f.ownerPassword || undefined,
        },
      });
      setMade(r);
      setF(EMPTY);
      void load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const closeDrawer = () => { setDrawer(false); setMade(null); setF(EMPTY); };

  return (
    <>
      <div className="page-head">
        <div><h1>Businesses</h1><p>{rows ? `${rows.length} business${rows.length === 1 ? '' : 'es'} use your software` : 'Loading…'}</p></div>
        <div className="head-actions">
          <button className="secondary btn-icon" disabled={!rows?.length} onClick={() => rows && downloadCsv('businesses.csv', ['Name', 'Code', 'City', 'Contact', 'Phone', 'Status', 'Ends', 'Monthly fee', 'Users', 'Requests 7d', 'Last active'], rows.map((t) => [t.name, t.code, t.city, t.contactName, t.phone, stateOf(t).label, t.expiresAt?.slice(0, 10), t.monthlyFee, t.users, t.requests7d, t.lastActiveAt?.slice(0, 10)]))}><Icon name="download" />Export CSV</button>
          <button className="btn-icon" onClick={() => setDrawer(true)}><Icon name="plus" />New business</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {rows && rows.length > 0 && (
        <StatTiles items={[
          { label: 'Active', value: count((t) => stateOf(t).label === 'Active'), icon: 'check', tone: 'green' },
          { label: 'On trial', value: count((t) => t.status === 'TRIAL'), icon: 'info' },
          { label: 'Need attention', value: count((t) => ['red', 'amber'].includes(stateOf(t).tone)), sub: 'ending, ended or suspended', icon: 'alert', tone: count((t) => ['red', 'amber'].includes(stateOf(t).tone)) ? 'amber' : 'green' },
          { label: 'Online now', value: (rows ?? []).reduce((s, t) => s + t.activeNow, 0), sub: 'people', icon: 'user' },
        ]} />
      )}

      <div className="list-head">
        <div className="filter"><Icon name="search" /><input aria-label="Search businesses" placeholder="Search name, code, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="chips" role="group" aria-label="Show">
          {([['all', 'All'], ['active', 'Active'], ['trial', 'Trial'], ['attention', 'Attention'], ['suspended', 'Suspended']] as [Filter, string][]).map(([v, l]) => (
            <button key={v} type="button" className={`chip${filter === v ? ' on' : ''}`} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        {rows && <span className="count-pill">{shown.length}</span>}
      </div>

      <table className="sticky-head">
        <thead><tr><th>Business</th><th>Status</th><th className="num">Users</th><th>Online</th><th>Last active</th><th className="num">Requests (7 d)</th><th className="num">Fee / month</th><th>Size</th><th>Ends</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {!rows && !error && <SkeletonRows cols={10} />}
          {shown.map((t) => {
            const s = stateOf(t);
            return (
              <tr key={t.id} className="row-link" onClick={() => router.push(`/admin/tenants/${t.id}`)}>
                <td>
                  <Link href={`/admin/tenants/${t.id}`} className="tenant-name" onClick={(e) => e.stopPropagation()}>
                    <span className="tenant-badge">{t.name.slice(0, 1).toUpperCase()}</span>
                    <span><b>{t.name}</b><small>{t.code}{t.city ? ` · ${t.city}` : ''}{t.isMain ? ' · your own business' : ''}</small></span>
                  </Link>
                </td>
                <td><span className={`badge ${s.tone}`}>{s.label}</span></td>
                <td className="num">{t.users}{t.maxUsers ? <span className="muted"> / {t.maxUsers}</span> : null}</td>
                <td>{t.activeNow > 0 ? <span className="badge green"><i className="live-dot" />{t.activeNow} online</span> : <span className="muted">—</span>}</td>
                <td className="muted">{ago(t.lastActiveAt)}</td>
                <td className="num">{t.requests7d.toLocaleString()}</td>
                <td className="num">{t.isMain ? <span className="muted">—</span> : t.monthlyFee ? rs(t.monthlyFee) : <span className="muted">Not set</span>}</td>
                <td className="muted nowrap">{sizes[t.id] != null ? bytes(sizes[t.id]) : '—'}</td>
                <td className="muted">{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No end date'}</td>
                <td onClick={(e) => e.stopPropagation()}>{t.phone && !t.isMain && <a className="attn-call wa" href={whatsapp(t.phone, renewalMessage(t))} target="_blank" rel="noreferrer" title="Message on WhatsApp" aria-label={`Message ${t.name} on WhatsApp`}><Icon name="message" /></a>}</td>
              </tr>
            );
          })}
          {rows && !shown.length && <tr><td colSpan={10}><Empty icon="customers" title={rows.length ? 'No business matches' : 'No businesses yet'} text={rows.length ? undefined : 'Add the first one; it gets its own empty system and owner account.'} /></td></tr>}
        </tbody>
      </table>

      {drawer && (
        <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) closeDrawer(); }}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="new-title" onKeyDown={(e) => { if (e.key === 'Escape') closeDrawer(); }}>
            {made ? (
              <>
                <header className="drawer-head">
                  <span className="drawer-icon ok"><Icon name="check" /></span>
                  <div><h2 id="new-title">{made.tenant.name} is ready</h2><p>Give these details to the owner. The password is shown only now.</p></div>
                  <button type="button" className="drawer-x" onClick={closeDrawer} aria-label="Close"><Icon name="x" /></button>
                </header>
                <div className="drawer-body">
                  <dl className="cred">
                    <div><dt>Sign-in page</dt><dd>{loginLink(made.tenant.code)}</dd><CopyButton text={loginLink(made.tenant.code)} /></div>
                    <div><dt>Business code</dt><dd>{made.tenant.code}</dd><CopyButton text={made.tenant.code} /></div>
                    <div><dt>Username</dt><dd>{made.owner.username}</dd><CopyButton text={made.owner.username} /></div>
                    <div><dt>Password</dt><dd className="mono">{made.owner.password}</dd><CopyButton text={made.owner.password} /></div>
                  </dl>
                  <CopyButton label="Copy everything as a message" text={`Your ${made.tenant.name} account is ready.\nOpen: ${loginLink(made.tenant.code)}\nBusiness code: ${made.tenant.code}\nUsername: ${made.owner.username}\nPassword: ${made.owner.password}\nPlease change the password after your first sign-in (Settings → My profile).`} />
                  <p className="fld-hint" style={{ marginTop: 14 }}>It starts empty: the usual godown and shop, the rice and bottle categories, and the owner account. Nothing from any other business is visible to it.</p>
                </div>
                <footer className="drawer-foot">
                  <span className="drawer-note" />
                  <button type="button" className="secondary" onClick={() => { setMade(null); }}>Add another</button>
                  <button type="button" onClick={() => { const id = made.tenant.id; closeDrawer(); router.push(`/admin/tenants/${id}`); }}>Open business</button>
                </footer>
              </>
            ) : (
              <form onSubmit={create}>
                <header className="drawer-head">
                  <span className="drawer-icon"><Icon name="customers" /></span>
                  <div><h2 id="new-title">New business</h2><p>A separate, empty system with its own owner account.</p></div>
                  <button type="button" className="drawer-x" onClick={closeDrawer} aria-label="Close"><Icon name="x" /></button>
                </header>
                <div className="drawer-body">
                  <FormSection title="Business">
                    <Field label="Business name" required span={12}><input autoFocus required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Ali Traders" /></Field>
                    <Field label="Sign-in code" optional span={12} hint={code ? `Staff sign in at ${typeof window === 'undefined' ? '' : window.location.origin}/login?business=${code}` : 'Made from the name when left empty. Small letters, numbers and hyphens.'}>
                      <input value={f.code} maxLength={30} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} placeholder={slug(f.name) || 'ali-traders'} />
                    </Field>
                    <Field label="Contact person" optional span={6}><input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
                    <Field label="Phone" optional span={6}><input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
                    <Field label="Email" optional span={6}><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
                    <Field label="City" optional span={6}><input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
                  </FormSection>
                  <FormSection title="Plan" description="You can change all of this later.">
                    <Field label="Starts as" span={12}>
                      <Choice name="new-status" value={f.status} onChange={(v) => setF({ ...f, status: v })} columns={2}
                        options={[{ value: 'TRIAL', label: 'Trial', description: 'Trying it out', icon: 'info' }, { value: 'ACTIVE', label: 'Active', description: 'Paying customer', icon: 'check' }]} />
                    </Field>
                    <Field label="Access ends on" optional span={6} hint="Sign-in stops after this day."><input type="date" value={f.expiresAt} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} /></Field>
                    <Field label="Most active users" optional span={6} hint="Empty = no limit."><Affix suffix="users"><input type="number" min={1} max={500} value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value })} /></Affix></Field>
                    <Field label="Monthly fee" optional span={12} hint="What they pay each month; used for your income figures."><Affix prefix="Rs"><input type="number" min={0} step="any" inputMode="decimal" value={f.monthlyFee} onChange={(e) => setF({ ...f, monthlyFee: e.target.value })} /></Affix></Field>
                    <Field label="Owner password" optional span={12} hint="Leave empty to make a strong one for you."><input minLength={8} maxLength={60} value={f.ownerPassword} onChange={(e) => setF({ ...f, ownerPassword: e.target.value })} autoComplete="off" /></Field>
                    <Field label="Notes" optional span={12}><textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Price agreed, who referred them, anything to remember" /></Field>
                  </FormSection>
                </div>
                <footer className="drawer-foot">
                  <span className="drawer-note"><span className="req">*</span> required</span>
                  <button type="button" className="secondary" onClick={closeDrawer}>Cancel</button>
                  <BusyButton busy={busy} disabled={f.name.trim().length < 2}><Icon name="check" />{busy ? 'Creating…' : 'Create business'}</BusyButton>
                </footer>
              </form>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
