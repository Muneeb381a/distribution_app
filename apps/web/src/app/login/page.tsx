'use client';

import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { BusyButton } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { forgetAccount, getBusiness, knownAccounts, setBusiness, type KnownAccount } from '@/lib/accounts';
import { api, saveSession, type SessionUser } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { setTheme, useTheme, type ThemePref } from '@/lib/theme';
import { DEFAULT_SETTINGS } from '@dist/shared';

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: follows device', light: 'Theme: light', dark: 'Theme: dark' };
const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

/**
 * Sign-in. Left: what the product does (desktop only). Right: the form, with the accounts already used
 * on this computer offered as one-tap "Continue as" so a returning person only types a password.
 */
export default function LoginPage() {
  const theme = useTheme();
  // The business name: last known on this PC first, then the server's (works before sign-in).
  const [brand, setBrand] = useState(DEFAULT_SETTINGS.businessName);
  const [error, setError] = useState('');
  // The business code: from the link (?business=ali-traders), else what was used last on this device. Empty = the original business.
  const [business, setBusinessCode] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get('business');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusinessCode((fromLink ?? getBusiness()).trim().toLowerCase());
    setReady(true);
    try {
      const why = sessionStorage.getItem('dist.blocked');
      if (why) { sessionStorage.removeItem('dist.blocked'); setError(why); }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!ready) return;
    const code = business.trim().toLowerCase();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!code) setBrand(getSettings().businessName);
    // A typed code is looked up after a short pause, so the name changes to that business own name.
    const t = setTimeout(() => {
      api<{ businessName: string }>(`/settings/public${code ? `?business=${encodeURIComponent(code)}` : ''}`).then((s) => setBrand(s.businessName)).catch(() => {});
    }, code ? 350 : 0);
    return () => clearTimeout(t);
  }, [business, ready]);

  const [accounts, setAccounts] = useState<KnownAccount[]>([]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAccounts(knownAccounts()); }, []);
  const [picked, setPicked] = useState<KnownAccount | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [help, setHelp] = useState(false);
  const pw = useRef<HTMLInputElement>(null);
  const user = useRef<HTMLInputElement>(null);

  const who = username.trim() ? accounts.find((a) => a.username === username.trim() && a.business === business.trim().toLowerCase()) ?? null : null;
  const name = picked ?? who;

  function pick(a: KnownAccount) {
    setPicked(a);
    setBusinessCode(a.business);
    setUsername(a.username);
    setError('');
    setTimeout(() => pw.current?.focus(), 0);
  }

  function switchAccount() {
    setPicked(null);
    setUsername('');
    setPassword('');
    setError('');
    setTimeout(() => user.current?.focus(), 0);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const code = business.trim().toLowerCase();
      const res = await api<{ accessToken: string; user: SessionUser }>('/auth/login', { method: 'POST', json: { username: username.trim(), password, business: code || undefined } });
      setBusiness(code);
      saveSession(res.accessToken, res.user);
      setWelcome(true);
      // A full page load, so nothing in memory from a previous business (receipt details, sync state) is carried over.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign('/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setShake((n) => n + 1);
      setBusy(false);
      pw.current?.select();
    }
  }

  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden="true">
        <div className="auth-brand-top"><span className="logo"><Icon name="products" /></span><b>{brand}</b></div>

        <div className="auth-hero">
          <p className="auth-urdu" dir="rtl" lang="ur">چاول اور مشروبات کی تقسیم</p>
          <h2>Your whole distribution business, on one screen.</h2>
          <p>Billing, khata, stock, deliveries and payroll for rice and beverage distributors. Fast at the counter, clear in the office.</p>
        </div>

        <div className="auth-preview">
          <div className="pv pv-a">
            <span className="pv-label">Today&apos;s sales</span>
            <b className="pv-value">Rs 84,200</b>
            <span className="pv-bars">{[38, 52, 44, 66, 58, 80, 100].map((h, i) => <i key={i} style={{ '--h': `${h}%` } as CSSProperties} className={i === 6 ? 'hot' : ''} />)}</span>
            <span className="pv-note"><Icon name="trend" />12% more than yesterday</span>
          </div>
          <div className="pv pv-b">
            <span className="pv-label">Udhaar collected</span>
            <b className="pv-value">Rs 31,500</b>
            <span className="pv-track"><i style={{ width: '68%' }} /></span>
            <span className="pv-note">68% of what was due this week</span>
          </div>
          <div className="pv pv-c">
            <span className="pv-tick"><Icon name="check" /></span>
            <span><b>Delivered</b><span className="pv-note">Slip signed by the receiver</span></span>
          </div>
        </div>

        <ul className="auth-points">
          <li><Icon name="print" />Thermal and A4 bills in Urdu and English</li>
          <li><Icon name="wifiOff" />Keeps billing when the internet drops</li>
          <li><Icon name="khata" />Credit limits and khata on every bill</li>
        </ul>
      </aside>

      <main className="auth-main">
        <header className="auth-bar">
          <span className="auth-mini-brand"><span className="logo"><Icon name="products" /></span><b>{brand}</b></span>
          <button type="button" className="auth-theme" onClick={() => setTheme(NEXT_THEME[theme])} aria-label={`${THEME_LABEL[theme]}. Switch to ${NEXT_THEME[theme]}.`} title={THEME_LABEL[theme]}>
            <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />
          </button>
        </header>

        <section className="auth-card" aria-labelledby="auth-title">
          <div className="auth-head rise" style={delay(40)}>
            <h1 id="auth-title">{name ? `Welcome back, ${(name.displayName || name.username).split(' ')[0]}` : 'Sign in'}</h1>
            <p>{name ? 'Enter your password to continue.' : `Use your account to open ${brand}.`}</p>
          </div>

          {!picked && accounts.length > 0 && (
            <div className="auth-accts rise" style={delay(100)} role="group" aria-label="Accounts used on this computer">
              <span className="auth-eyebrow">Continue as</span>
              {accounts.map((a) => (
                <span key={`${a.business}/${a.username}`} className="auth-acct-wrap">
                  <button type="button" className="auth-acct" onClick={() => pick(a)}>
                    <Avatar user={a} size={40} />
                    <span className="auth-acct-text"><b>{a.displayName || a.username}</b><span>{a.roleName}{a.business ? ` · ${a.business}` : ''}</span></span>
                    <Icon name="chevronRight" />
                  </button>
                  <button type="button" className="auth-acct-x" aria-label={`Remove ${a.username} from this list`} title="Remove from this list" onClick={() => { forgetAccount(a.username, a.business); setAccounts(knownAccounts()); }}><Icon name="x" /></button>
                </span>
              ))}
              <span className="auth-or"><span>or use another account</span></span>
            </div>
          )}

          <form key={shake} className={`auth-form${shake ? ' shake' : ''}`} onSubmit={submit} noValidate={false}>
            {picked ? (
              <div className="auth-picked rise pop" style={delay(60)}>
                <Avatar user={picked} size={48} className="auth-picked-pic" />
                <span className="auth-acct-text"><b>{picked.displayName || picked.username}</b><span>{picked.roleName} · @{picked.username}{picked.business ? ` · ${picked.business}` : ''}</span></span>
                <button type="button" className="auth-link" onClick={switchAccount}>Switch</button>
              </div>
            ) : (
              <>
              <div className="auth-field rise" style={delay(100)}>
                <div className="auth-label-row"><label htmlFor="auth-biz">Business code</label><span className="auth-opt">Leave empty if you were not given one</span></div>
                <span className="auth-input">
                  <Icon name="locations" />
                  <input id="auth-biz" value={business} onChange={(e) => setBusinessCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoCapitalize="none" autoComplete="organization" spellCheck={false} placeholder="e.g. ali-traders" />
                </span>
              </div>
              <div className="auth-field rise" style={delay(140)}>
                <label htmlFor="auth-user">Username</label>
                <span className="auth-input">
                  <Icon name="user" />
                  <input id="auth-user" ref={user} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!accounts.length} required autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Your username" />
                </span>
              </div>
              </>
            )}

            <div className="auth-field rise" style={delay(200)}>
              <div className="auth-label-row">
                <label htmlFor="auth-pass">Password</label>
                <button type="button" className="auth-link" aria-expanded={help} onClick={() => setHelp(!help)}>Forgot password?</button>
              </div>
              <span className="auth-input">
                <Icon name="lock" />
                <input
                  id="auth-pass" ref={pw} type={show ? 'text' : 'password'} value={password} required autoComplete="current-password" placeholder="Your password"
                  onChange={(e) => setPassword(e.target.value)} onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))} onBlur={() => setCaps(false)}
                />
                <button type="button" className="auth-eye" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} onClick={() => setShow(!show)}>
                  <Icon name={show ? 'eyeOff' : 'eye'} />
                </button>
              </span>
              {caps && <span className="auth-hint warn"><Icon name="alert" />Caps Lock is on</span>}
              {help && <p className="auth-help pop"><Icon name="info" /><span>Passwords can&apos;t be looked up. Ask the owner to set a new one for you under <b>Users &amp; roles</b>.</span></p>}
            </div>

            <div aria-live="polite">
              {error && <p className="auth-alert pop" role="alert"><Icon name="alert" />{error}</p>}
            </div>

            <div className="rise" style={delay(260)}>
              <BusyButton busy={busy} className="auth-submit" disabled={welcome}>
                {welcome ? 'Opening your dashboard…' : busy ? 'Signing in…' : <>Sign in<Icon name="chevronRight" /></>}
              </BusyButton>
            </div>
          </form>
        </section>

        <footer className="auth-foot"><Icon name="lock" />Secure sign-in · {brand}</footer>
      </main>
    </div>
  );
}
