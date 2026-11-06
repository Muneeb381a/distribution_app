'use client';

import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { BusyButton, useToast } from '@/components/Feedback';
import { Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { api, updateUser, useUser, type SessionUser } from '@/lib/api';
import { pictureFromFile } from '@/lib/image';
import { usePageTitle } from '@/lib/pageTitle';

/** 0 (too short) .. 4 (strong), from length and the mix of characters. */
function strength(pw: string) {
  if (pw.length < 6) return { score: 0, label: pw ? 'Too short' : '' };
  const score = Math.min(4, 1 + (pw.length >= 10 ? 1 : 0) + (/[a-z]/.test(pw) && /[A-Z]/.test(pw) ? 1 : 0) + (/\d/.test(pw) ? 1 : 0) + (/[^A-Za-z0-9]/.test(pw) ? 1 : 0) - (pw.length < 8 ? 1 : 0));
  return { score: Math.max(1, score), label: ['', 'Weak', 'Fair', 'Good', 'Strong'][Math.max(1, score)] };
}

function PasswordInput({ value, onChange, autoComplete, required, minLength, placeholder }: {
  value: string; onChange: (v: string) => void; autoComplete: string; required?: boolean; minLength?: number; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required={required} minLength={minLength} placeholder={placeholder} />
      <button type="button" className="pw-eye" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}>
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </span>
  );
}

/** My profile: picture, display name and own password. Everyone can change their own; nobody can change another person's picture. */
export default function ProfilePage() {
  usePageTitle('My profile');
  const user = useUser();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [picBusy, setPicBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', again: '' });
  const [pwBusy, setPwBusy] = useState(false);

  if (!user) return null;
  const shownName = name ?? user.displayName ?? '';
  const nameDirty = name !== null && name.trim() !== (user.displayName ?? '');
  const meter = strength(pw.next);
  const mismatch = pw.again.length > 0 && pw.again !== pw.next;
  const pwReady = pw.current.length > 0 && pw.next.length >= 6 && pw.next === pw.again && pw.next !== pw.current;

  async function save(patch: { displayName?: string; avatar?: string | null }) {
    const fresh = await api<SessionUser>('/auth/profile', { method: 'PATCH', json: patch });
    updateUser(fresh);
  }

  async function choose(f: File | undefined) {
    if (!f) return;
    setPicBusy(true);
    try {
      await save({ avatar: await pictureFromFile(f) });
      toast.success('Profile picture updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPicBusy(false);
      if (file.current) file.current.value = '';
    }
  }

  async function removePic() {
    setPicBusy(true);
    try { await save({ avatar: null }); toast.success('Picture removed'); } catch (e) { toast.error((e as Error).message); } finally { setPicBusy(false); }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameBusy(true);
    try { await save({ displayName: shownName }); setName(null); toast.success('Name saved'); } catch (err) { toast.error((err as Error).message); } finally { setNameBusy(false); }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (!pwReady) return;
    setPwBusy(true);
    try {
      await api('/auth/password', { method: 'POST', json: { current: pw.current, next: pw.next } });
      setPw({ current: '', next: '', again: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPwBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); void choose(e.dataTransfer.files[0]); };

  return (
    <>
      <div className="page-head"><div><h1>My profile</h1><p>Your picture and name show in the menu and on this computer&apos;s sign-in page.</p></div></div>
      <div className="profile-grid">
        <section className="card profile-card">
          <div
            className={`pic-drop${drag ? ' over' : ''}${picBusy ? ' busy' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
          >
            <Avatar user={user} size={132} className="pic-xl" />
            <button type="button" className="pic-cam" aria-label="Change picture" onClick={() => file.current?.click()} disabled={picBusy}><Icon name="edit" /></button>
          </div>
          <h2 className="profile-name">{user.displayName || user.username}</h2>
          <p className="profile-handle">@{user.username}</p>
          <span className="badge teal">{user.roleName}</span>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => void choose(e.target.files?.[0])} />
          <div className="profile-pic-actions">
            <BusyButton type="button" busy={picBusy} onClick={() => file.current?.click()}><Icon name="import" />{user.avatar ? 'Change picture' : 'Add picture'}</BusyButton>
            {user.avatar && <button type="button" className="secondary" disabled={picBusy} onClick={removePic}>Remove</button>}
          </div>
          <p className="profile-tip">Drop a photo on the picture, or choose one. It is cropped to a square and made small automatically.</p>
        </section>

        <div className="profile-forms">
          <FormCard
            onSubmit={saveName}
            title="Personal details"
            description="How you appear to others on this computer."
            actions={(
              <FormActions note={nameDirty ? 'Unsaved changes' : 'All changes saved'}>
                {nameDirty && <button type="button" className="secondary" onClick={() => setName(null)}>Discard</button>}
                <BusyButton busy={nameBusy} disabled={!nameDirty}><Icon name="check" />Save changes</BusyButton>
              </FormActions>
            )}
          >
            <FormSection>
              <Field label="Display name" optional span={12} hint="Shown instead of your username in menus and on bills you create.">
                <input value={shownName} maxLength={60} placeholder={user.username} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Username" span={12} hint="You sign in with this. Ask the owner if it needs to change.">
                <input value={user.username} readOnly disabled />
              </Field>
            </FormSection>
          </FormCard>

          <FormCard
            onSubmit={changePassword}
            title="Password"
            description="Choose something others cannot guess. You stay signed in on this computer."
            actions={(
              <FormActions note={pw.next && pw.next === pw.current ? 'The new password must be different' : undefined}>
                <BusyButton busy={pwBusy} disabled={!pwReady}><Icon name="lock" />Change password</BusyButton>
              </FormActions>
            )}
          >
            <FormSection>
              <Field label="Current password" required span={12}>
                <PasswordInput value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} autoComplete="current-password" required />
              </Field>
              <Field
                label="New password" required span={12}
                hint={(
                  <span className="pw-meter" data-score={meter.score}>
                    <span className="pw-meter-bars"><i /><i /><i /><i /></span>
                    <span className="pw-meter-label">{meter.label || 'At least 6 characters. A longer mix of letters, numbers and symbols is stronger.'}</span>
                  </span>
                )}
              >
                <PasswordInput value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" required minLength={6} />
              </Field>
              <Field label="Confirm new password" required span={12} error={mismatch ? 'The two passwords are not the same' : undefined}>
                <PasswordInput value={pw.again} onChange={(v) => setPw({ ...pw, again: v })} autoComplete="new-password" required minLength={6} />
              </Field>
            </FormSection>
          </FormCard>
        </div>
      </div>
    </>
  );
}
