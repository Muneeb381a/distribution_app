'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { BusyButton, Empty, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Field, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { ago, platformApi, usePlatformAdmin } from '@/lib/platform';

interface Admin { id: string; username: string; displayName: string | null; isActive: boolean; createdAt: string; lastLoginAt: string | null }
interface Audit { id: string; adminName: string; action: string; tenantName: string | null; detail: Record<string, unknown> | null; createdAt: string }

const ACTIONS: Record<string, string> = {
  CREATE_TENANT: 'Created a business', UPDATE_TENANT: 'Changed a business', SUSPEND_TENANT: 'Suspended a business', ACTIVATE_TENANT: 'Let a business back in',
  RESET_PASSWORD: 'Made a new password', DELETE_TENANT: 'Deleted a business', CREATE_ADMIN: 'Added a platform admin', UPDATE_ADMIN: 'Changed a platform admin',
};

export default function TeamPage() {
  const me = usePlatformAdmin();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [add, setAdd] = useState({ username: '', displayName: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    platformApi<Admin[]>('/admins').then(setAdmins).catch((e) => setError(e.message));
    platformApi<Audit[]>('/audit').then(setAudit).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.again) return toast.error('The two new passwords are not the same');
    setBusy(true);
    try {
      await platformApi('/auth/password', { method: 'POST', json: { current: pw.current, next: pw.next } });
      toast.success('Password changed');
      setPw({ current: '', next: '', again: '' });
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  async function addAdmin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await platformApi('/admins', { method: 'POST', json: { username: add.username.trim().toLowerCase(), displayName: add.displayName || undefined, password: add.password } });
      toast.success(`${add.username} can now sign in to the console`);
      setAdd({ username: '', displayName: '', password: '' });
      load();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  }

  async function toggle(a: Admin) {
    if (a.isActive && !(await confirm({ title: `Turn off ${a.username}?`, body: <p>They can no longer sign in to the console. You can turn them on again.</p>, confirmLabel: 'Turn off', danger: true }))) return;
    try { await platformApi(`/admins/${a.id}`, { method: 'PATCH', json: { isActive: !a.isActive } }); toast.success(a.isActive ? 'Turned off' : 'Turned on'); load(); } catch (err) { toast.error((err as Error).message); }
  }

  async function reset(a: Admin) {
    const password = await prompt({ title: `New password for ${a.username}`, label: 'New password (8 or more characters)', type: 'password', minLength: 8, confirmLabel: 'Set password' });
    if (!password) return;
    try { await platformApi(`/admins/${a.id}`, { method: 'PATCH', json: { password } }); toast.success('Password set'); } catch (err) { toast.error((err as Error).message); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Team &amp; security</h1><p>Who can sign in to this console, and what they did.</p></div></div>
      {error && <p className="error">{error}</p>}

      <div className="admin-settings">
        <section className="card">
          <div className="card-head"><h3>Platform admins</h3>{admins && <span className="count-pill">{admins.length}</span>}</div>
          <ul className="admins">
            {admins?.map((a) => (
              <li key={a.id} className={a.isActive ? '' : 'off'}>
                <Avatar user={{ username: a.displayName || a.username }} size={36} />
                <span className="admins-text"><b>{a.displayName || a.username}{a.id === me?.id && <span className="badge blue">You</span>}</b><small>@{a.username} · last sign-in {ago(a.lastLoginAt)}</small></span>
                {a.id !== me?.id && (
                  <span className="btn-row">
                    <button type="button" className="secondary" onClick={() => void reset(a)}>New password</button>
                    <button type="button" className={`secondary${a.isActive ? ' danger-hover' : ''}`} onClick={() => void toggle(a)}>{a.isActive ? 'Turn off' : 'Turn on'}</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <form onSubmit={addAdmin} className="form-grid">
            <FormSection title="Add a platform admin" description="They see every business. Give this only to people you trust fully.">
              <Field label="Username" required span={6}><input required minLength={3} maxLength={40} value={add.username} onChange={(e) => setAdd({ ...add, username: e.target.value })} autoCapitalize="none" autoComplete="off" /></Field>
              <Field label="Name" optional span={6}><input maxLength={60} value={add.displayName} onChange={(e) => setAdd({ ...add, displayName: e.target.value })} /></Field>
              <Field label="First password" required span={12} hint="At least 8 characters. They should change it after signing in."><input required minLength={8} maxLength={60} value={add.password} onChange={(e) => setAdd({ ...add, password: e.target.value })} autoComplete="off" /></Field>
            </FormSection>
            <div className="form-actions"><BusyButton busy={busy} disabled={!add.username || add.password.length < 8}><Icon name="plus" />Add admin</BusyButton></div>
          </form>
        </section>

        <div className="admin-side">
          <form className="card" onSubmit={changePassword}>
            <div className="card-head"><h3>Your password</h3></div>
            <div className="form-grid">
              <FormSection>
                <Field label="Current password" required span={12}><input type="password" required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
                <Field label="New password" required span={12}><input type="password" required minLength={8} autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
                <Field label="New password again" required span={12}><input type="password" required minLength={8} autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} /></Field>
              </FormSection>
            </div>
            <div className="form-actions"><BusyButton busy={busy}><Icon name="lock" />Change password</BusyButton></div>
          </form>
        </div>
      </div>

      <div className="section-head"><h2>What was done here</h2>{audit && <span className="count-pill">{audit.length}</span>}</div>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>What</th><th>Business</th></tr></thead>
        <tbody>
          {audit?.map((a) => (
            <tr key={a.id}>
              <td className="nowrap" title={new Date(a.createdAt).toLocaleString()}>{ago(a.createdAt)}</td>
              <td><b>{a.adminName}</b></td>
              <td>{ACTIONS[a.action] ?? a.action}{a.detail && typeof a.detail.reason === 'string' && a.detail.reason ? <span className="muted"> · “{a.detail.reason}”</span> : null}</td>
              <td>{a.tenantName ?? <span className="muted">—</span>}</td>
            </tr>
          ))}
          {audit && !audit.length && <tr><td colSpan={4}><Empty icon="history" title="Nothing yet" /></td></tr>}
        </tbody>
      </table>
    </>
  );
}
