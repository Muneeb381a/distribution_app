'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { api, clearSession, type SessionUser } from '@/lib/api';
import { setTheme, useTheme, type ThemePref } from '@/lib/theme';

const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemePref, string> = { system: 'Theme: follows device', light: 'Theme: light', dark: 'Theme: dark' };

interface Hit { group: string; title: string; sub: string; href: string }

export default function TopBar({ user, onMenu, crumbs, status }: { user: SessionUser; onMenu: () => void; crumbs: { label: string; href?: string }[]; status?: React.ReactNode }) {
  const router = useRouter();
  const theme = useTheme();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    let stale = false;
    const t = setTimeout(() => {
      setLoading(true);
      api<Hit[]>(`/search?q=${encodeURIComponent(text)}`)
        .then((r) => { if (!stale) { setHits(r); setActive(0); } })
        .catch(() => { if (!stale) setHits([]); })
        .finally(() => { if (!stale) setLoading(false); });
    }, 220);
    return () => { stale = true; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === 'Escape') setMenuOpen(false);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      } else if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const click = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
      if (!menu.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', click); };
  }, []);

  const go = (h: Hit) => {
    setOpen(false);
    setQ('');
    setHits([]);
    router.push(h.href);
  };

  const shown = q.trim().length >= 2 ? hits : [];

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && shown[active]) go(shown[active]);
    else if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
  }

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <header className="topbar">
      <button className="menu-btn" aria-label="Open menu" onClick={onMenu}><Icon name="menu" /></button>
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          {crumbs.map((c, i) => (
            <li key={i} aria-current={i === crumbs.length - 1 ? 'page' : undefined}>
              {c.href ? <Link href={c.href}>{c.label}</Link> : <span>{c.label}</span>}
            </li>
          ))}
        </ol>
      </nav>
      <div className="search" ref={box}>
        <Icon name="search" />
        <input
          ref={input}
          value={q}
          placeholder="Search customers, products, bills…"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          aria-label="Search"
        />
        <kbd>Ctrl K</kbd>
        {open && q.trim().length >= 2 && (
          <div className="search-pop">
            {shown.map((h, i) => {
              const head = i === 0 || shown[i - 1].group !== h.group;
              return (
                <div key={h.href + h.title + i}>
                  {head && <div className="search-group">{h.group}</div>}
                  <button className={`search-item${i === active ? ' active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(h)}>
                    <b>{h.title}</b>
                    <span>{h.sub}</span>
                  </button>
                </div>
              );
            })}
            {!shown.length && <div className="search-empty">{loading ? 'Searching…' : `Nothing found for “${q.trim()}”`}</div>}
          </div>
        )}
      </div>
      <div className="top-right">
        {status}
        <button
          type="button" className="top-icon" onClick={() => setTheme(NEXT_THEME[theme])}
          aria-label={`${THEME_LABEL[theme]}. Switch to ${NEXT_THEME[theme]}.`} title={THEME_LABEL[theme]}
        >
          <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />
        </button>
        <div className="user-menu" ref={menu}>
          <button type="button" className="avatar-btn" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Account menu" onClick={() => setMenuOpen(!menuOpen)}>
            <Avatar user={user} size={32} />
            <Icon name="chevronDown" />
          </button>
          {menuOpen && (
            <div className="user-pop" role="menu">
              <div className="user-pop-head">
                <Avatar user={user} size={44} />
                <div className="who-text"><b>{user.displayName || user.username}</b><span>{user.roleName}</span></div>
              </div>
              <div className="user-pop-date">{today}</div>
              <Link href="/profile" role="menuitem" className="user-pop-item" onClick={() => setMenuOpen(false)}><Icon name="user" />My profile</Link>
              <button
                type="button" role="menuitem" className="user-pop-item"
                onClick={() => { clearSession(); router.replace('/login'); }}
              >
                <Icon name="logout" />Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
