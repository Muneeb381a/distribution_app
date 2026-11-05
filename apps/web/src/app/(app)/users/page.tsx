'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { BusyButton, SkeletonRows, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { PERMISSION_GROUPS } from '@dist/shared';

interface Role { id: string; name: string; permissions: { permissionCode: string }[] }
interface User { id: string; username: string; isActive: boolean; role: { id: string; name: string } }


function RoleEditor({ initial, onSave, onCancel }: { initial: { name: string; permissions: string[] }; onSave: (name: string, perms: string[]) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial.name);
  const [perms, setPerms] = useState(new Set(initial.permissions));
  const [busy, setBusy] = useState(false);
  const toggle = (p: string) => setPerms((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await onSave(name, [...perms]);
    setBusy(false);
  }

  return (
    <form className="card" onSubmit={submit}>
      <div className="form" style={{ marginBottom: 18 }}>
        <label>Role name<input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <span className="muted" style={{ alignSelf: 'center' }}>{perms.size} permissions selected</span>
      </div>
      <div className="perm-grid">
        {PERMISSION_GROUPS.map((g) => (
          <div key={g.title}>
            <h3>{g.title}</h3>
            {g.items.map(([code, label]) => (
              <label key={code} className="perm"><input type="checkbox" checked={perms.has(code)} onChange={() => toggle(code)} />{label}</label>
            ))}
          </div>
        ))}
      </div>
      <div className="form-actions" style={{ marginTop: 18 }}>
        <button disabled={busy}>{busy ? 'Saving…' : 'Save role'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [form, setForm] = useState({ username: '', password: '', roleId: '' });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();
  const me = useUser();
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const prompt = usePrompt();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([api<User[]>('/users'), api<Role[]>('/roles')]);
      setUsers(u);
      setRoles(r);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await api('/users', { method: 'POST', json: form });
      setForm({ username: '', password: '', roleId: '' });
      setAdding(false);
      toast.success(`User ${form.username} created`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function patch(id: string, body: object, done?: string) {
    try {
      await api(`/users/${id}`, { method: 'PATCH', json: body });
      if (done) toast.success(done);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function saveRole(id: string | 'new', name: string, permissions: string[]) {
    try {
      await api(id === 'new' ? '/roles' : `/roles/${id}`, { method: id === 'new' ? 'POST' : 'PATCH', json: { name, permissions } });
      setEditing(null);
      toast.success(`Role "${name}" saved. The change applies immediately.`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const editingRole = roles.find((r) => r.id === editing);

  return (
    <>
      <div className="page-head">
        <div><h1>Users &amp; roles</h1><p>{users.length} users · {roles.length} roles</p></div>
        <div className="actions">
          {can(me, 'AUDIT_VIEW') && <Link className="btn" href="/audit"><Icon name="history" />Audit log</Link>}
          {!adding && <button className="btn-icon" onClick={() => setAdding(true)}><Icon name="plus" />Add user</button>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {adding && (
        <FormCard
          onSubmit={create}
          title="New user"
          description="Each person signs in with their own account. What they can do comes from their role."
          actions={
            <FormActions>
              <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
              <BusyButton busy={creating}>Create user</BusyButton>
            </FormActions>
          }
        >
          <FormSection>
            <Field label="Username" required span={4} hint="At least 3 characters, no spaces">
              <input required minLength={3} pattern="\S+" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.trim() })} />
            </Field>
            <Field label="Password" required span={4} hint="At least 6 characters. Ask them to remember it — the owner can reset it.">
              <input required type="password" minLength={6} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </Field>
            <Field label="Role" required span={4} hint={form.roleId ? `${roles.find((r) => r.id === form.roleId)?.permissions.length ?? 0} permissions` : undefined}>
              <select required value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
                <option value="">Select role…</option>
                {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          </FormSection>
        </FormCard>
      )}

      <table>
        <thead><tr><th>User</th><th>Role</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {!loaded && <SkeletonRows cols={4} rows={3} />}
          {users.map((u) => (
            <tr key={u.id} className={u.isActive ? '' : 'inactive'}>
              <td>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="avatar" style={{ width: 30, height: 30, fontSize: 11 }}>{u.username.slice(0, 2)}</span>
                  <b>{u.username}</b>{u.id === me?.id && <span className="badge teal">You</span>}
                </span>
              </td>
              <td>
                <select aria-label={`Role for ${u.username}`} disabled={u.id === me?.id} value={u.role.id} onChange={(e) => patch(u.id, { roleId: e.target.value }, `${u.username} is now ${roles.find((r) => r.id === e.target.value)?.name}`)}>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </td>
              <td><span className={`badge ${u.isActive ? 'green' : 'red'}`}>{u.isActive ? 'Active' : 'Disabled'}</span></td>
              <td>
                <div className="row-actions">
                <button
                  className="secondary"
                  disabled={u.id === me?.id}
                  title={u.id === me?.id ? 'You cannot disable yourself' : undefined}
                  onClick={async () => {
                    if (u.isActive && !(await confirm({ title: `Disable ${u.username}?`, body: <p>They are signed out and cannot sign in until enabled again.</p>, confirmLabel: 'Disable', danger: true }))) return;
                    patch(u.id, { isActive: !u.isActive }, `${u.username} ${u.isActive ? 'disabled' : 'enabled'}`);
                  }}
                >{u.isActive ? 'Disable' : 'Enable'}</button>
                <button
                  className="secondary"
                  onClick={async () => {
                    const p = await prompt({ title: `Reset password for ${u.username}`, label: 'New password', type: 'password', minLength: 6, confirmLabel: 'Change password' });
                    if (p) patch(u.id, { password: p }, `Password changed for ${u.username}`);
                  }}
                >Reset password</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="page-head" style={{ marginTop: 32 }}>
        <div><h2 style={{ margin: 0 }}>Roles</h2><p>What each kind of user is allowed to do.</p></div>
        {editing === null && <button className="secondary" onClick={() => setEditing('new')}><Icon name="plus" /> New role</button>}
      </div>

      {editing === 'new' && <RoleEditor initial={{ name: '', permissions: [] }} onCancel={() => setEditing(null)} onSave={(n, p) => saveRole('new', n, p)} />}
      {editingRole && <RoleEditor key={editingRole.id} initial={{ name: editingRole.name, permissions: editingRole.permissions.map((p) => p.permissionCode) }} onCancel={() => setEditing(null)} onSave={(n, p) => saveRole(editingRole.id, n, p)} />}

      <table>
        <thead><tr><th>Role</th><th>Permissions</th><th /></tr></thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id}>
              <td><strong>{r.name}</strong></td>
              <td>{r.name === 'Owner' ? <span className="badge blue">Everything</span> : r.permissions.length ? r.permissions.map((p) => <span key={p.permissionCode} className="badge" style={{ marginRight: 4 }}>{p.permissionCode.toLowerCase().replace(/_/g, ' ')}</span>) : '—'}</td>
              <td>{r.name === 'Owner' ? <span className="muted">Locked</span> : <button className="secondary" onClick={() => setEditing(r.id)}>Edit</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
