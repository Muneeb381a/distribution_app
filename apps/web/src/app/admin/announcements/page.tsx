'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BusyButton, Empty, useConfirm, useToast } from '@/components/Feedback';
import { Choice, Field, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { ago, platformApi, type Tenant } from '@/lib/platform';

interface Announcement {
  id: string; title: string; body: string | null; level: 'INFO' | 'WARNING' | 'CRITICAL'; tenantId: string | null; tenantName: string | null;
  startsAt: string; endsAt: string | null; isActive: boolean; live: boolean; createdByName: string; createdAt: string;
}

const LEVELS = [
  { value: 'INFO', label: 'Information', description: 'A notice', icon: 'info' as const },
  { value: 'WARNING', label: 'Warning', description: 'Maintenance, change', icon: 'alert' as const },
  { value: 'CRITICAL', label: 'Urgent', description: 'Needs action now', icon: 'ban' as const },
];
const TONE = { INFO: 'blue', WARNING: 'amber', CRITICAL: 'red' } as const;
const EMPTY = { title: '', body: '', level: 'INFO', tenantId: '', endsAt: '' };

/** Messages that appear as a banner inside the software, for everyone or for one business. */
export default function AnnouncementsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => platformApi<Announcement[]>('/announcements').then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    platformApi<Tenant[]>('/tenants').then(setTenants).catch(() => {});
    const q = new URLSearchParams(window.location.search).get('tenantId');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) { setF((x) => ({ ...x, tenantId: q })); setDrawer(true); }
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await platformApi('/announcements', { method: 'POST', json: { title: f.title.trim(), body: f.body.trim() || undefined, level: f.level, tenantId: f.tenantId || undefined, endsAt: f.endsAt ? new Date(`${f.endsAt}T23:59:59`).toISOString() : undefined } });
      toast.success('Published. It shows inside the software within a minute.');
      setDrawer(false);
      setF(EMPTY);
      void load();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  async function toggle(a: Announcement) {
    try { await platformApi(`/announcements/${a.id}`, { method: 'PATCH', json: { isActive: !a.isActive } }); void load(); } catch (e) { toast.error((e as Error).message); }
  }

  async function remove(a: Announcement) {
    if (!(await confirm({ title: 'Delete this message?', body: <p>“{a.title}” is removed for good and disappears from the software.</p>, confirmLabel: 'Delete', danger: true }))) return;
    try { await platformApi(`/announcements/${a.id}`, { method: 'DELETE' }); toast.success('Deleted'); void load(); } catch (e) { toast.error((e as Error).message); }
  }

  const live = rows?.filter((r) => r.live).length ?? 0;

  return (
    <>
      <div className="page-head">
        <div><h1>Announcements</h1><p>Tell your customers something; it shows as a banner inside their software.</p></div>
        <button className="btn-icon" onClick={() => setDrawer(true)}><Icon name="plus" />New announcement</button>
      </div>
      {error && <p className="error">{error}</p>}
      {rows && <p className="muted" style={{ margin: '0 0 12px' }}>{live ? `${live} message${live === 1 ? ' is' : 's are'} showing right now.` : 'Nothing is showing right now.'}</p>}

      <div className="ann-list">
        {rows?.map((a) => (
          <article key={a.id} className={`card ann ${TONE[a.level]}${a.live ? '' : ' off'}`}>
            <span className="ann-bar" aria-hidden="true" />
            <div className="ann-main">
              <div className="ann-top">
                <b>{a.title}</b>
                {a.live ? <span className="badge green"><i className="live-dot" />Showing</span> : <span className="badge">{a.isActive ? 'Ended' : 'Off'}</span>}
                <span className={`badge ${TONE[a.level]}`}>{LEVELS.find((l) => l.value === a.level)?.label}</span>
              </div>
              {a.body && <p>{a.body}</p>}
              <small className="muted">To {a.tenantName ? <b>{a.tenantName}</b> : 'every business'} · {a.endsAt ? `until ${new Date(a.endsAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'no end date'} · by {a.createdByName} {ago(a.createdAt)}</small>
            </div>
            <div className="btn-row">
              <button type="button" className="secondary" onClick={() => void toggle(a)}>{a.isActive ? 'Turn off' : 'Turn on'}</button>
              <button type="button" className="secondary icon-only danger-hover" aria-label="Delete" title="Delete" onClick={() => void remove(a)}><Icon name="x" /></button>
            </div>
          </article>
        ))}
        {rows && !rows.length && <Empty icon="message" title="No announcements yet" text="Use one for maintenance, a new feature, or a renewal reminder to a single business." action={<button type="button" onClick={() => setDrawer(true)}><Icon name="plus" />Write the first one</button>} />}
      </div>

      {drawer && (
        <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setDrawer(false); }}>
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="ann-title" onKeyDown={(e) => { if (e.key === 'Escape') setDrawer(false); }}>
            <form onSubmit={create}>
              <header className="drawer-head">
                <span className="drawer-icon"><Icon name="message" /></span>
                <div><h2 id="ann-title">New announcement</h2><p>Shown at the top of the software until it ends or you turn it off.</p></div>
                <button type="button" className="drawer-x" onClick={() => setDrawer(false)} aria-label="Close"><Icon name="x" /></button>
              </header>
              <div className="drawer-body">
                <div className={`ann-preview ${TONE[f.level as keyof typeof TONE]}`} aria-live="polite">
                  <Icon name={LEVELS.find((l) => l.value === f.level)?.icon ?? 'info'} />
                  <span><b>{f.title || 'Your title appears here'}</b>{f.body && <small>{f.body}</small>}</span>
                </div>
                <FormSection>
                  <Field label="Title" required span={12}><input autoFocus required minLength={2} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Maintenance tonight 1 to 2 am" /></Field>
                  <Field label="More details" optional span={12}><textarea rows={3} maxLength={1000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
                  <Field label="Kind" span={12}><Choice name="ann-level" value={f.level} onChange={(v) => setF({ ...f, level: v })} columns={3} options={LEVELS} /></Field>
                  <Field label="Who sees it" span={8}>
                    <select value={f.tenantId} onChange={(e) => setF({ ...f, tenantId: e.target.value })}>
                      <option value="">Every business</option>
                      {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Stop showing on" optional span={4}><input type="date" min={new Date().toISOString().slice(0, 10)} value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} /></Field>
                </FormSection>
              </div>
              <footer className="drawer-foot">
                <span className="drawer-note"><span className="req">*</span> required</span>
                <button type="button" className="secondary" onClick={() => setDrawer(false)}>Cancel</button>
                <BusyButton busy={busy} disabled={f.title.trim().length < 2}><Icon name="check" />{busy ? 'Publishing…' : 'Publish'}</BusyButton>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
