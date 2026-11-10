'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BusyButton } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { platformApi, savePlatformSession, usePlatformAdmin, type PlatformAdmin } from '@/lib/platform';

/** Sign-in for the platform console. Staff of a business sign in at /login with their business code instead. */
export default function AdminLoginPage() {
  const router = useRouter();
  const admin = usePlatformAdmin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (admin) router.replace('/admin'); }, [admin, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await platformApi<{ accessToken: string; admin: PlatformAdmin }>('/auth/login', { method: 'POST', json: { username: username.trim().toLowerCase(), password } });
      savePlatformSession(r.accessToken, r.admin);
      router.replace('/admin');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="admin-login">
      <section className="admin-login-card">
        <span className="logo"><Icon name="panel" /></span>
        <h1>Platform console</h1>
        <p>Sign in to manage the businesses that use your software.</p>
        <form onSubmit={submit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="pl-user">Username</label>
            <span className="auth-input"><Icon name="user" /><input id="pl-user" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Platform username" /></span>
          </div>
          <div className="auth-field">
            <label htmlFor="pl-pass">Password</label>
            <span className="auth-input">
              <Icon name="lock" />
              <input id="pl-pass" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" placeholder="Your password" />
              <button type="button" className="auth-eye" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}><Icon name={show ? 'eyeOff' : 'eye'} /></button>
            </span>
          </div>
          <div aria-live="polite">{error && <p className="auth-alert pop" role="alert"><Icon name="alert" />{error}</p>}</div>
          <BusyButton busy={busy} className="auth-submit">{busy ? 'Signing in…' : <>Sign in<Icon name="chevronRight" /></>}</BusyButton>
        </form>
        <p className="admin-login-foot"><Icon name="lock" />Every sign-in here is recorded with its address and device.</p>
      </section>
    </div>
  );
}
