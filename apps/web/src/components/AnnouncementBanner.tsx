'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';

interface Item { id: string; title: string; body: string | null; level: 'INFO' | 'WARNING' | 'CRITICAL' }

const KEY = 'dist.ann.dismissed';
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]; } catch { return []; } };

/** Messages from the software provider, shown above the page. Urgent ones stay until they end. */
export function AnnouncementBanner() {
  const [items, setItems] = useState<Item[]>([]);
  const [gone, setGone] = useState<string[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGone(read());
    const load = () => api<Item[]>('/announcements').then(setItems).catch(() => {});
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, []);

  const shown = items.filter((i) => i.level === 'CRITICAL' || !gone.includes(i.id));
  if (!shown.length) return null;

  const dismiss = (id: string) => {
    const next = [...gone, id].slice(-50);
    setGone(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* it just comes back next time */ }
  };

  return (
    <div className="ann-banners" role="region" aria-label="Messages">
      {shown.map((i) => (
        <div key={i.id} className={`ann-banner ${i.level.toLowerCase()}`} role={i.level === 'CRITICAL' ? 'alert' : 'status'}>
          <Icon name={i.level === 'INFO' ? 'info' : 'alert'} />
          <span><b>{i.title}</b>{i.body && <small>{i.body}</small>}</span>
          {i.level !== 'CRITICAL' && <button type="button" aria-label="Dismiss" onClick={() => dismiss(i.id)}><Icon name="x" /></button>}
        </div>
      ))}
    </div>
  );
}
