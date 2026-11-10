'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Empty, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { ago, platformApi } from '@/lib/platform';

interface Security {
  failed24h: number; uniqueIps24h: number;
  topIps: { ip: string; count: number; users: string[]; businesses: string[]; country: string | null; city: string | null; last: string; blocked: boolean }[];
  blocked: { id: string; ip: string; reason: string | null; createdByName: string; createdAt: string }[];
  multiCountry: { tenantId: string; name: string; countries: string[] }[];
}

/** Wrong passwords, addresses that keep trying, and a way to shut an address out. */
export default function SecurityPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [s, setS] = useState<Security | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => platformApi<Security>('/security').then((r) => { setS(r); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function block(ip: string) {
    const reason = await prompt({ title: `Block ${ip}?`, body: <p>Nobody can open the software, or this console, from this address. You can lift it again any time.</p>, label: 'Reason (for your own record)', confirmLabel: 'Block address', danger: true, initial: 'Guessing passwords' });
    if (reason === null) return;
    try { await platformApi('/blocked-ips', { method: 'POST', json: { ip, reason } }); toast.success(`${ip} is blocked`); void load(); } catch (e) { toast.error((e as Error).message); }
  }

  async function add() {
    const ip = await prompt({ title: 'Block an address', label: 'IP address, e.g. 203.0.113.9', confirmLabel: 'Next' });
    if (ip) await block(ip.trim());
  }

  async function unblock(id: string, ip: string) {
    if (!(await confirm({ title: `Let ${ip} back in?`, confirmLabel: 'Unblock' }))) return;
    try { await platformApi(`/blocked-ips/${id}`, { method: 'DELETE' }); toast.success('Unblocked'); void load(); } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Security</h1><p>Who is trying to get in, and from where. Refreshes by itself.</p></div>
        <button className="secondary btn-icon" onClick={() => void add()}><Icon name="ban" />Block an address</button>
      </div>
      {error && <p className="error">{error}</p>}

      <StatTiles items={[
        { label: 'Wrong sign-ins (24 h)', value: s?.failed24h ?? '—', icon: 'alert', tone: s && s.failed24h > 20 ? 'amber' : 'green' },
        { label: 'Different addresses', value: s?.uniqueIps24h ?? '—', sub: 'that failed in 24 h', icon: 'locations' },
        { label: 'Blocked addresses', value: s?.blocked.length ?? '—', icon: 'ban', tone: s?.blocked.length ? 'amber' : undefined },
        { label: 'From several countries', value: s?.multiCountry.length ?? '—', sub: 'businesses, last 30 days', icon: 'user', tone: s?.multiCountry.length ? 'amber' : 'green' },
      ]} />

      <div className="section-head"><h2>Addresses that failed to sign in</h2><span className="muted">last 24 hours</span></div>
      <table>
        <thead><tr><th>Address</th><th>Place</th><th className="num">Failed</th><th>Tried</th><th>Business</th><th>Last try</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {s?.topIps.map((r) => (
            <tr key={r.ip} className={r.blocked ? 'inactive' : ''}>
              <td className="mono"><b>{r.ip}</b></td>
              <td>{[r.city, r.country].filter(Boolean).join(', ') || 'Unknown'}</td>
              <td className="num"><span className={`badge ${r.count >= 8 ? 'red' : r.count >= 3 ? 'amber' : ''}`}>{r.count}</span></td>
              <td className="muted">{r.users.join(', ')}{r.users.length >= 6 ? '…' : ''}</td>
              <td className="muted">{r.businesses.join(', ') || '—'}</td>
              <td className="muted">{ago(r.last)}</td>
              <td>{r.blocked ? <span className="badge red">Blocked</span> : <button type="button" className="secondary danger-hover" onClick={() => void block(r.ip)}>Block</button>}</td>
            </tr>
          ))}
          {s && !s.topIps.length && <tr><td colSpan={7}><Empty icon="lock" title="No failed sign-ins in the last day" text="Good. Nobody has been guessing passwords." /></td></tr>}
        </tbody>
      </table>

      <div className="admin-grid">
        <section className="card">
          <div className="card-head"><h3>Blocked addresses</h3>{s && s.blocked.length > 0 && <span className="count-pill">{s.blocked.length}</span>}</div>
          {s && !s.blocked.length && <p className="muted">No address is blocked.</p>}
          <ul className="due-list">
            {s?.blocked.map((b) => (
              <li key={b.id}>
                <Icon name="ban" />
                <span className="attn-main"><b className="mono">{b.ip}</b><span>{b.reason || 'No reason written'} · by {b.createdByName} {ago(b.createdAt)}</span></span>
                <button type="button" className="secondary" onClick={() => void unblock(b.id, b.ip)}>Unblock</button>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="card-head"><h3>Used from more than one country</h3></div>
          <p className="muted" style={{ marginTop: -6 }}>Not always wrong (travel, a VPN), but worth a look if the owner works from one place only.</p>
          {s && !s.multiCountry.length && <p className="muted">None.</p>}
          <ul className="due-list">
            {s?.multiCountry.map((m) => (
              <li key={m.tenantId}>
                <Icon name="locations" />
                <Link href={`/admin/tenants/${m.tenantId}`} className="attn-main"><b>{m.name}</b><span>{m.countries.join(' · ')}</span></Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
