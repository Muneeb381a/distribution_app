'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BusyButton, Empty, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { localDay } from '@dist/shared';

interface Holiday { id: string; date: string; name: string; employeeIds: string[] }
interface Person { id: string; name: string; type?: string; weeklyOff?: number | null }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Fixed-date public holidays; the Eid and Muharram dates follow the moon, so those only fill in the name. */
const PRESETS: { name: string; md?: string }[] = [
  { name: 'Pakistan Day', md: '03-23' }, { name: 'Labour Day', md: '05-01' }, { name: 'Independence Day', md: '08-14' },
  { name: 'Iqbal Day', md: '11-09' }, { name: 'Quaid-e-Azam Day', md: '12-25' },
  { name: 'Eid ul Fitr' }, { name: 'Eid ul Adha' }, { name: 'Ashura' }, { name: 'Eid Milad un Nabi' },
];

const ymd = (d: Date) => localDay(d);
const dayText = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Holidays and days off. A holiday is not a working day for the people it covers: a monthly salary is not cut
 * for it and a daily wage is not paid for it (unless they came to work). The weekly day off works the same way.
 */
export default function HolidaysPage() {
  usePageTitle('Holidays & days off');
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const today = ymd(new Date());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [holidays, setHolidays] = useState<Holiday[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [bulkDay, setBulkDay] = useState('');
  const [busy, setBusy] = useState('');

  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);
  useEffect(() => {
    const y = new Date().getFullYear();
    Promise.all([api<Holiday[]>(`/holidays?from=${y - 1}-01-01&to=${y + 1}-12-31`), api<Person[]>('/employees/options')])
      .then(([h, p]) => { setHolidays(h); setPeople(p); setError(''); })
      .catch((e) => setError(e.message));
  }, [tick]);

  const byDate = useMemo(() => new Map((holidays ?? []).map((h) => [h.date.slice(0, 10), h])), [holidays]);
  const [y, m] = month.split('-').map(Number);
  const cells = useMemo(() => {
    const first = new Date(y, m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // week starts on Monday
    const count = new Date(y, m, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => ymd(new Date(y, m - 1, i + 1)))] as (string | null)[];
  }, [y, m]);
  const shift = (by: number) => { const d = new Date(y, m - 1 + by, 1); setMonth(ymd(d).slice(0, 7)); };

  const upcoming = (holidays ?? []).filter((h) => h.date.slice(0, 10) >= today);
  const thisYear = (holidays ?? []).filter((h) => h.date.startsWith(String(new Date().getFullYear()))).length;
  const withOff = people.filter((p) => p.weeklyOff != null).length;
  const grouped = useMemo(() => {
    const g = new Map<string, Holiday[]>();
    for (const h of holidays ?? []) {
      if (h.date.slice(0, 4) < String(new Date().getFullYear())) continue;
      const k = h.date.slice(0, 7);
      g.set(k, [...(g.get(k) ?? []), h]);
    }
    return [...g.entries()];
  }, [holidays]);

  if (!user) return null;
  if (!can(user, 'PAYROLL_MANAGE')) return <p className="error">You need the payroll permission to manage holidays.</p>;

  async function remove(h: Holiday) {
    if (!(await confirm({ title: `Remove ${h.name}?`, body: <p>{dayText(h.date)} becomes a normal working day again. Payroll that is already finalised is not changed.</p>, confirmLabel: 'Remove', danger: true }))) return;
    try { await api(`/holidays/${h.id}`, { method: 'DELETE' }); toast.success('Holiday removed'); load(); } catch (e) { toast.error((e as Error).message); }
  }

  async function setOff(ids: string[] | null, value: number | null, label: string) {
    setBusy(label);
    try {
      const r = await api<{ updated: number }>('/weekly-off', { method: 'PUT', json: { weeklyOff: value, ...(ids ? { employeeIds: ids } : {}) } });
      toast.success(ids ? 'Weekly off saved' : `Weekly off set for ${r.updated} employee${r.updated === 1 ? '' : 's'}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Holidays &amp; days off</h1><p>Days nobody has to work. Salary is not cut for them.</p></div>
        <button className="btn-icon" onClick={() => setAdding(today)}><Icon name="plus" />Add holiday</button>
      </div>
      {error && <p className="error">{error}</p>}

      <StatTiles items={[
        { label: 'Holidays this year', value: thisYear, icon: 'history' },
        { label: 'Coming up', value: upcoming.length, sub: upcoming[0] ? `next: ${upcoming[0].name}, ${dayText(upcoming[0].date)}` : 'nothing planned', icon: 'trend', tone: 'amber' },
        { label: 'Have a weekly off', value: `${withOff}/${people.length}`, sub: withOff ? 'staff with a fixed day off' : 'no weekly off set yet', icon: 'employees', tone: withOff ? 'green' : 'amber' },
      ]} />

      <div className="hol-grid">
        <section className="card">
          <div className="hol-cal-head">
            <button type="button" className="secondary icon-only" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="chevronLeft" /></button>
            <h2>{new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h2>
            <button type="button" className="secondary icon-only" onClick={() => shift(1)} aria-label="Next month"><Icon name="chevronRight" /></button>
            {month !== today.slice(0, 7) && <button type="button" className="secondary" onClick={() => setMonth(today.slice(0, 7))}>Today</button>}
          </div>
          <div className="hol-cal" role="grid" aria-label="Holiday calendar">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <span key={d} className="hol-dow">{d}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`b${i}`} />;
              const h = byDate.get(d);
              return (
                <button key={d} type="button" className={`hol-day${h ? ' off' : ''}${d === today ? ' today' : ''}`} onClick={() => setAdding(d)} title={h ? `${h.name}${h.employeeIds.length ? ' (some staff)' : ''}` : 'Add a holiday on this day'}>
                  <span>{Number(d.slice(8))}</span>
                  {h && <i>{h.name}</i>}
                </button>
              );
            })}
          </div>
          <p className="muted hol-note">Click any day to make it a holiday. Weekly days off are set per person on the right and are not drawn here.</p>
        </section>

        <section className="card">
          <div className="card-head"><h2>Weekly day off</h2></div>
          <p className="card-sub">Pick the day each person is off every week, for example Friday. Monthly staff are not cut for it; daily-wage staff are not paid for it unless they work.</p>
          <div className="hol-bulk">
            <select aria-label="Day off for everyone" value={bulkDay} onChange={(e) => setBulkDay(e.target.value)}>
              <option value="">Choose a day…</option>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              <option value="none">No weekly off</option>
            </select>
            <BusyButton type="button" busy={busy === 'all'} disabled={!bulkDay || !people.length} onClick={async () => {
              if (!(await confirm({ title: 'Set it for everyone?', body: <p>This replaces each employee&apos;s weekly off with {bulkDay === 'none' ? 'no weekly off' : DAYS[Number(bulkDay)]}.</p>, confirmLabel: 'Set for everyone' }))) return;
              await setOff(null, bulkDay === 'none' ? null : Number(bulkDay), 'all');
            }}>Set for everyone</BusyButton>
          </div>
          <ul className="list hol-people">
            {people.map((p) => (
              <li key={p.id}>
                <span className="who-line"><b>{p.name}</b><span>{p.type === 'DAILY' ? 'Daily wage' : 'Monthly salary'}</span></span>
                <select aria-label={`Weekly off for ${p.name}`} value={p.weeklyOff ?? ''} disabled={busy === p.id} onChange={(e) => { setPeople(people.map((x) => (x.id === p.id ? { ...x, weeklyOff: e.target.value === '' ? null : Number(e.target.value) } : x))); void setOff([p.id], e.target.value === '' ? null : Number(e.target.value), p.id); }}>
                  <option value="">None</option>
                  {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                </select>
              </li>
            ))}
            {!people.length && <li className="muted">No employees yet.</li>}
          </ul>
        </section>
      </div>

      <div className="section-head"><h2>All holidays</h2>{holidays && <span className="count-pill">{grouped.reduce((s, [, l]) => s + l.length, 0)}</span>}</div>
      {holidays && !grouped.length && <Empty icon="history" title="No holidays yet" text="Add Eid, 14 August and any other day off, ahead of time." action={<button type="button" onClick={() => setAdding(today)}><Icon name="plus" />Add holiday</button>} />}
      {grouped.map(([k, list]) => (
        <section key={k} className="card hol-month">
          <h3>{new Date(`${k}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</h3>
          <ul className="list">
            {list.map((h) => (
              <li key={h.id}>
                <span className="who-line"><b>{h.name}</b><span>{dayText(h.date)} · {h.employeeIds.length ? `${h.employeeIds.length} chosen staff` : 'everyone'}</span></span>
                <button type="button" className="secondary icon-only danger-hover" onClick={() => remove(h)} aria-label={`Remove ${h.name}`} title="Remove"><Icon name="x" /></button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {adding && <AddHoliday start={adding} people={people} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); load(); }} />}
    </>
  );
}

function AddHoliday({ start, people, onClose, onSaved }: { start: string; people: Person[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState('');
  const [several, setSeveral] = useState(false);
  const [who, setWho] = useState<'all' | 'some'>('all');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const preset = (p: { name: string; md?: string }) => {
    setName(p.name);
    if (p.md) {
      const y = new Date().getFullYear();
      setFrom(`${p.md < today().slice(5) ? y + 1 : y}-${p.md}`);
    }
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (who === 'some' && !chosen.length) { toast.error('Choose at least one person, or pick everyone'); return; }
    setBusy(true);
    try {
      const r = await api<{ holidays: unknown[]; finalised: number; finalisedMonths: string[] }>('/holidays', {
        method: 'POST',
        json: { name, date: from, ...(several && to ? { toDate: to } : {}), ...(who === 'some' ? { employeeIds: chosen } : {}) },
      });
      toast.success(`${name} added${r.holidays.length > 1 ? ` (${r.holidays.length} days)` : ''}`);
      if (r.finalised) toast.error(`Payroll for ${r.finalisedMonths.join(', ')} is already finalised, so it is not changed.`);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="hol-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <form onSubmit={submit}>
          <header className="drawer-head">
            <span className="drawer-icon"><Icon name="history" /></span>
            <div><h2 id="hol-title">Add a holiday</h2><p>Nobody it covers is cut for this day, and daily-wage staff are not paid for it unless they work.</p></div>
            <button type="button" className="drawer-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </header>
          <div className="drawer-body">
            <div className="fld">
              <label className="fld-label" htmlFor="hol-name"><span>Name</span><span className="req" aria-hidden="true">*</span></label>
              <input id="hol-name" required autoFocus maxLength={80} value={name} placeholder="e.g. Eid ul Fitr" onChange={(e) => setName(e.target.value)} />
              <div className="chips hol-presets" role="group" aria-label="Common holidays">
                {PRESETS.map((p) => <button key={p.name} type="button" className={`chip${name === p.name ? ' on' : ''}`} onClick={() => preset(p)}>{p.name}</button>)}
              </div>
              <p className="fld-hint">Eid and Muharram follow the moon: pick the name, then set the dates once they are announced.</p>
            </div>
            <div className="hol-dates">
              <div className="fld"><label className="fld-label" htmlFor="hol-from"><span>{several ? 'First day' : 'Date'}</span><span className="req" aria-hidden="true">*</span></label><input id="hol-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              {several && <div className="fld"><label className="fld-label" htmlFor="hol-to"><span>Last day</span><span className="req" aria-hidden="true">*</span></label><input id="hol-to" type="date" required min={from} value={to} onChange={(e) => setTo(e.target.value)} /></div>}
            </div>
            <label className="hol-check"><input type="checkbox" checked={several} onChange={(e) => { setSeveral(e.target.checked); if (!e.target.checked) setTo(''); }} />It lasts more than one day (Eid is often 3 days)</label>
            <div className="fld">
              <span className="fld-label"><span>Who is off</span></span>
              <div className="pick-chips" role="radiogroup" aria-label="Who is off">
                <button type="button" role="radio" aria-checked={who === 'all'} className={`pick-chip${who === 'all' ? ' on' : ''}`} onClick={() => setWho('all')}>Everyone</button>
                <button type="button" role="radio" aria-checked={who === 'some'} className={`pick-chip${who === 'some' ? ' on' : ''}`} onClick={() => setWho('some')}>Only some people</button>
              </div>
              {who === 'some' && (
                <ul className="hol-pick">
                  {people.map((p) => (
                    <li key={p.id}><label><input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} />{p.name}<span className="muted">{p.type === 'DAILY' ? 'daily wage' : 'monthly'}</span></label></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <footer className="drawer-foot">
            <span className="drawer-note"><span className="req">*</span> required</span>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <BusyButton busy={busy}><Icon name="check" />Add holiday</BusyButton>
          </footer>
        </form>
      </aside>
    </div>
  );
}

const today = () => ymd(new Date());
