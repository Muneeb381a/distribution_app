'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api, clearSession, type SessionUser } from '@/lib/api';

interface Hit { group: string; title: string; sub: string; href: string }

export default function TopBar({ user, onMenu }: { user: SessionUser; onMenu: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

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
      if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        input.current?.focus();
      }
    };
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
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

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <header className="topbar">
      <button className="menu-btn" aria-label="Open menu" onClick={onMenu}><Icon name="menu" /></button>
      <div className="search" ref={box}>
        <Icon name="search" />
        <input
          ref={input}
          value={q}
          placeholder="Search customers, products, suppliers, bills…"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          aria-label="Search"
        />
        <kbd>/</kbd>
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
        <span className="top-date">{today}</span>
        <div className="top-user">
          <div className="avatar">{user.username.slice(0, 2)}</div>
          <div className="who-text"><b>{user.username}</b><span>{user.roleName}</span></div>
        </div>
        <button
          className="logout"
          onClick={() => {
            clearSession();
            router.replace('/login');
          }}
        >
          <Icon name="logout" /> Logout
        </button>
      </div>
    </header>
  );
}
