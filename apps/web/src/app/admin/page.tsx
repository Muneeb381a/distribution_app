'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Spark } from '@/components/AdminBits';
import { Empty } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { ago, bytes, deviceLine, place, platformApi, rs, stateOf, type LoginEvent, type Tenant } from '@/lib/platform';

interface Overview {
  tenants: { total: number; active: number; trial: number; suspended: number; expired: number; expiringSoon: number; active24h: number; idle14d: number };
  activeNow: number; logins24h: number; failedLogins24h: number; requestsToday: number;
  series: { day: string; requests: number; writes: number }[];
  top: { tenantId: string; name: string; requests: number }[];
  recentLogins: LoginEvent[];
}

interface Money { mrr: string; collectedThisMonth: string; overdue: unknown[]; dueSoon: unknown[] }
interface Storage { usedBytes: number; limitBytes: number; perTenant: { tenantId: string; bytes: number }[] }

export default function AdminOverviewPage() {
  const [money, setMoney] = useState<Money | null>(null);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [o, setO] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState('');
  const [now] = useState(() => Date.now());

  useEffect(() => {
    const load = () => {
      platformApi<Overview>('/overview').then((r) => { setO(r); setError(''); }).catch((e) => setError(e.message));
      platformApi<Tenant[]>('/tenants').then(setTenants).catch(() => {});
      platformApi<Money>('/billing/summary').then(setMoney).catch(() => {});
      platformApi<Storage>('/storage').then(setStorage).catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const attention = useMemo(() => {
    const list: { t: Tenant; why: string; tone: 'red' | 'amber' | 'blue' }[] = [];
    for (const t of tenants) {
      if (t.status === 'SUSPENDED') list.push({ t, why: t.suspendedReason ? `Suspended: ${t.suspendedReason}` : 'Suspended', tone: 'red' });
      else if (t.expiresAt && (t.daysLeft ?? 0) < 0) list.push({ t, why: `Ended ${Math.abs(t.daysLeft ?? 0)} day${Math.abs(t.daysLeft ?? 0) === 1 ? '' : 's'} ago`, tone: 'red' });
      else if (t.expiresAt && (t.daysLeft ?? 99) <= 14) list.push({ t, why: `Ends in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}`, tone: 'amber' });
      else if (!t.isMain && (!t.lastActiveAt || now - new Date(t.lastActiveAt).getTime() > 14 * 86_400_000)) list.push({ t, why: t.lastActiveAt ? `Not used since ${ago(t.lastActiveAt)}` : 'Never used yet', tone: 'blue' });
    }
    return list;
  }, [tenants, now]);

    return (
    <>
      <div className="page-head">
        <div><h1>Overview</h1><p>Every business using your software, at a glance. Refreshes by itself.</p></div>
        <Link href="/admin/tenants?new=1" className="btn-icon button"><Icon name="plus" />New business</Link>
      </div>
      {error && <p className="error">{error}</p>}

      <StatTiles items={[
        { label: 'Businesses', value: o?.tenants.total ?? '—', sub: o ? `${o.tenants.active} active · ${o.tenants.trial} on trial` : undefined, icon: 'customers' },
        { label: 'Working right now', value: o?.activeNow ?? '—', sub: 'people seen in the last 15 min', icon: 'user', tone: o?.activeNow ? 'green' : undefined },
        { label: 'Sign-ins (24 h)', value: o?.logins24h ?? '—', sub: o ? `${o.failedLogins24h} failed` : undefined, icon: 'lock', tone: o && o.failedLogins24h > 10 ? 'amber' : undefined },
        { label: 'Requests today', value: o?.requestsToday ?? '—', sub: o ? `${o.tenants.active24h} business${o.tenants.active24h === 1 ? '' : 'es'} active today` : undefined, icon: 'trend' },
      ]} />

      <StatTiles items={[
        { label: 'Monthly income', value: money ? rs(money.mrr) : '—', sub: 'from businesses with a fee', icon: 'trend', tone: 'green' },
        { label: 'Received this month', value: money ? rs(money.collectedThisMonth) : '—', icon: 'wallet' },
        { label: 'Have run out', value: money?.overdue.length ?? '—', sub: money?.overdue.length ? 'access ended, not renewed' : 'all renewed', icon: 'alert', tone: money?.overdue.length ? 'red' : 'green' },
        { label: 'Database used', value: storage ? `${Math.round((storage.usedBytes / storage.limitBytes) * 100)}%` : '—', sub: storage ? `${bytes(storage.usedBytes)} of ${bytes(storage.limitBytes)}` : undefined, icon: 'cloud', tone: storage && storage.usedBytes / storage.limitBytes > 0.8 ? 'red' : storage && storage.usedBytes / storage.limitBytes > 0.6 ? 'amber' : undefined },
      ]} />
      {storage && storage.usedBytes / storage.limitBytes > 0.6 && (
        <p className="alert-bar"><Icon name="alert" />The database is {Math.round((storage.usedBytes / storage.limitBytes) * 100)}% full ({bytes(storage.usedBytes)} of {bytes(storage.limitBytes)}). Upgrade the database plan before it fills up, or new data will stop saving.</p>
      )}

      <div className="admin-grid">
        <section className="card">
          <div className="card-head"><h3>Use over the last 14 days</h3><span className="muted">requests per day</span></div>
          <Spark label="Requests per day, last 14 days" data={(o?.series ?? Array.from({ length: 14 }, (_, i) => ({ day: `0000-00-${String(i).padStart(2, '0')}`, requests: 0, writes: 0 }))).map((s) => ({
            key: s.day, value: s.requests, tick: s.day.slice(8), note: `${s.day}: ${s.requests} requests, ${s.writes} changes`,
          }))} />
        </section>

        <section className="card">
          <div className="card-head"><h3>Busiest this week</h3></div>
          {o && !o.top.length && <p className="muted">No activity recorded yet.</p>}
          <ul className="list">
            {o?.top.map((t, i) => (
              <li key={t.tenantId} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Link href={`/admin/tenants/${t.tenantId}`}><b>{i + 1}. {t.name}</b></Link><span className="amt">{t.requests.toLocaleString()}</span>
                </span>
                <span className="meter" aria-hidden="true"><span style={{ width: `${(t.requests / (o.top[0]?.requests || 1)) * 100}%`, background: 'var(--accent)' }} /></span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="admin-grid">
        <section className="card">
          <div className="card-head"><h3>Needs your attention</h3>{attention.length > 0 && <span className="count-pill">{attention.length}</span>}</div>
          {!attention.length && <p className="muted">Nothing to chase. Every business is in good standing and being used.</p>}
          <ul className="attn-list">
            {attention.map(({ t, why, tone }) => (
              <li key={t.id}>
                <span className={`attn-dot ${tone}`} aria-hidden="true" />
                <Link href={`/admin/tenants/${t.id}`} className="attn-main"><b>{t.name}</b><span>{why}</span></Link>
                {t.phone && <a className="attn-call" href={`tel:${t.phone}`} title={`Call ${t.phone}`}><Icon name="phone" /></a>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="card-head"><h3>Latest sign-ins</h3><Link href="/admin/activity?tab=log" className="muted">See all</Link></div>
          {o && !o.recentLogins.length && <Empty icon="lock" title="No sign-ins yet" />}
          <ul className="feed">
            {o?.recentLogins.map((e) => (
              <li key={e.id}>
                <span className={`feed-dot ${e.success ? 'ok' : 'bad'}`} aria-hidden="true" />
                <span className="feed-main">
                  <b>{e.username}</b> <span className="muted">{e.scope === 'PLATFORM' ? 'platform console' : e.tenantName ?? e.tenantCode ?? 'unknown business'}</span>
                  <small>{e.success ? '' : `${e.reason ?? 'Failed'} · `}{place(e)} · {deviceLine(e)}{e.ip ? ` · ${e.ip}` : ''}</small>
                </span>
                <span className="muted feed-when">{ago(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {tenants.length > 0 && (
        <>
          <div className="section-head"><h2>All businesses</h2><Link href="/admin/tenants" className="muted">Manage</Link></div>
          <div className="tenant-mini">
            {tenants.slice(0, 8).map((t) => {
              const s = stateOf(t);
              return (
                <Link key={t.id} href={`/admin/tenants/${t.id}`} className="card tenant-mini-card">
                  <span className="tenant-mini-top"><b>{t.name}</b><span className={`badge ${s.tone}`}>{s.label}</span></span>
                  <span className="muted">{t.code} · {t.users} user{t.users === 1 ? '' : 's'}</span>
                  <span className="tenant-mini-foot"><span>{t.activeNow > 0 ? <><i className="live-dot" /> {t.activeNow} online</> : `Last seen ${ago(t.lastActiveAt)}`}</span><span>{t.requests7d.toLocaleString()} req / 7 d</span></span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
