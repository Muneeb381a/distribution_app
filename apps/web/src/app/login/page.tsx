'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BusyButton } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api, saveSession, type SessionUser } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { DEFAULT_SETTINGS } from '@dist/shared';

export default function LoginPage() {
  // The business name: last known on this PC first, then the server's (works before sign-in).
  const [brand, setBrand] = useState(DEFAULT_SETTINGS.businessName);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBrand(getSettings().businessName);
    api<{ businessName: string }>('/settings/public').then((s) => setBrand(s.businessName)).catch(() => {});
  }, []);
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ accessToken: string; user: SessionUser }>('/auth/login', { method: 'POST', json: { username, password } });
      saveSession(res.accessToken, res.user);
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <aside className="login-art" aria-hidden="true">
        <div className="brand-row"><span className="logo"><Icon name="products" /></span>{brand}</div>
        <div>
          <p className="ur-line" dir="rtl" lang="ur">چاول اور مشروبات کی تقسیم</p>
          <h2>Bills, khata and stock for rice &amp; beverages — in one place.</h2>
          <p>Counter and delivery billing, customer udhaar, godown and vehicle stock, payroll and daily profit.</p>
          <ul>
            <li><Icon name="print" />Thermal and A4 bills in Urdu and English</li>
            <li><Icon name="wifiOff" />Keeps billing when the internet drops</li>
            <li><Icon name="khata" />Credit limits and khata on every bill</li>
          </ul>
        </div>
        <span style={{ opacity: 0.7, fontSize: 13 }}>Rice &amp; Beverages distribution</span>
      </aside>
      <main className="login-side">
        <div className="login">
          <span className="logo" style={{ marginBottom: 18 }}><Icon name="products" /></span>
          <h1>Welcome back</h1>
          <p className="muted" style={{ margin: 0 }}>Sign in to your distribution account.</p>
          <form className="form" onSubmit={submit}>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required autoComplete="username" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </label>
            {error && <p className="error" role="alert" style={{ margin: 0 }}>{error}</p>}
            <BusyButton busy={busy}>{busy ? 'Signing in…' : 'Sign in'}</BusyButton>
          </form>
          <div className="foot"><span>Forgot your password? Ask the owner to reset it.</span></div>
        </div>
      </main>
    </div>
  );
}
