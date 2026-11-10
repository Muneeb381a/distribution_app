'use client';

import { useCallback, useEffect, useState } from 'react';
import { LoginTable } from '@/components/AdminBits';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { ago, deviceLine, place, platformApi, type LoginEvent, type SeenRow, type Tenant } from '@/lib/platform';

type Tab = 'live' | 'log';

/** Who is working right now across all businesses, and every sign-in attempt that was made. */
export default function ActivityPage() {
  const [tab, setTab] = useState<Tab>('live');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [sessions, setSessions] = useState<SeenRow[] | null>(null);
  const [hours, setHours] = useState(24);
  const [logs, setLogs] = useState<LoginEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState({ tenantId: '', result: '', q: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p.get('tab') === 'log') setTab('log');
    if (p.get('tenantId')) setFilter((f) => ({ ...f, tenantId: p.get('tenantId')! }));
    platformApi<Tenant[]>('/tenants').then(setTenants).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab !== 'live') return;
    const load = () => platformApi<SeenRow[]>(`/sessions?hours=${hours}`).then((r) => { setSessions(r); setError(''); }).catch((e) => setError(e.message));
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [tab, hours]);

  const loadLog = useCallback((before?: string) => {
    const qs = new URLSearchParams({ limit: '50' });
    if (filter.tenantId) qs.set('tenantId', filter.tenantId);
    if (filter.result) qs.set('result', filter.result);
    if (filter.q.trim()) qs.set('q', filter.q.trim());
    if (before) qs.set('before', before);
    return platformApi<{ rows: LoginEvent[]; more: boolean }>(`/logins?${qs}`).then((r) => {
      setLogs((old) => (before ? [...(old ?? []), ...r.rows] : r.rows));
      setMore(r.more);
      setError('');
    }).catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => {
    if (tab !== 'log') return;
    const t = setTimeout(() => void loadLog(), filter.q ? 300 : 0);
    return () => clearTimeout(t);
  }, [tab, loadLog, filter.q]);

  const online = (sessions ?? []).filter((s) => s.activeNow);
  const people = new Set(online.map((s) => `${s.tenantId}/${s.username}`)).size;
  const places = new Set(online.map((s) => s.city || s.country).filter(Boolean)).size;

  return (
    <>
      <div className="page-head"><div><h1>Activity</h1><p>Who uses the software, from where, and on what device.</p></div></div>
      {error && <p className="error">{error}</p>}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'live'} className={`tab${tab === 'live' ? ' on' : ''}`} onClick={() => setTab('live')}>Working now{online.length > 0 && <span className="tab-dot" />}</button>
        <button role="tab" aria-selected={tab === 'log'} className={`tab${tab === 'log' ? ' on' : ''}`} onClick={() => setTab('log')}>Sign-in log</button>
      </div>

      {tab === 'live' && (
        <>
          <StatTiles items={[
            { label: 'Online now', value: people, sub: 'seen in the last 15 minutes', icon: 'user', tone: people ? 'green' : undefined },
            { label: 'Devices', value: online.length, icon: 'phone' },
            { label: 'Places', value: places, sub: 'cities right now', icon: 'locations' },
            { label: `Seen in ${hours === 24 ? '24 hours' : hours === 168 ? '7 days' : '30 days'}`, value: sessions?.length ?? '—', sub: 'person + device pairs', icon: 'history' },
          ]} />
          <div className="list-head">
            <div className="chips" role="group" aria-label="Period">
              {([[24, '24 hours'], [168, '7 days'], [720, '30 days']] as [number, string][]).map(([h, l]) => (
                <button key={h} type="button" className={`chip${hours === h ? ' on' : ''}`} aria-pressed={hours === h} onClick={() => { setHours(h); setSessions(null); }}>{l}</button>
              ))}
            </div>
          </div>
          <table className="sticky-head">
            <thead><tr><th>Person</th><th>Business</th><th>Device</th><th>Place</th><th>Address</th><th>Last seen</th><th className="num">Requests</th></tr></thead>
            <tbody>
              {!sessions && !error && <SkeletonRows cols={7} />}
              {sessions?.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.username}</b></td>
                  <td>{r.tenantName}</td>
                  <td>{deviceLine(r)}</td>
                  <td>{place(r)}</td>
                  <td className="mono">{r.ip ?? '—'}</td>
                  <td>{r.activeNow ? <span className="badge green"><i className="live-dot" />Online</span> : <span className="muted">{ago(r.lastSeen)}</span>}</td>
                  <td className="num">{r.hits.toLocaleString()}</td>
                </tr>
              ))}
              {sessions && !sessions.length && <tr><td colSpan={7}><Empty icon="user" title="Nobody has been active" text="People appear here once they sign in and use the app." /></td></tr>}
            </tbody>
          </table>
        </>
      )}

      {tab === 'log' && (
        <>
          <div className="list-head">
            <div className="filter"><Icon name="search" /><input aria-label="Search the log" placeholder="Search a person, address, city or business code…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} /></div>
            <select aria-label="Business" value={filter.tenantId} onChange={(e) => setFilter({ ...filter, tenantId: e.target.value })}>
              <option value="">All businesses</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <div className="chips" role="group" aria-label="Result">
              {([['', 'All'], ['ok', 'Signed in'], ['failed', 'Failed']] as [string, string][]).map(([v, l]) => (
                <button key={v} type="button" className={`chip${filter.result === v ? ' on' : ''}`} aria-pressed={filter.result === v} onClick={() => setFilter({ ...filter, result: v })}>{l}</button>
              ))}
            </div>
          </div>
          {!logs && !error && <div className="skeleton" style={{ height: 160 }} />}
          {logs && <LoginTable rows={logs} showBusiness />}
          {more && logs && logs.length > 0 && <div className="load-more"><button type="button" className="secondary" onClick={() => void loadLog(logs[logs.length - 1].createdAt)}>Show older</button></div>}
        </>
      )}
    </>
  );
}
