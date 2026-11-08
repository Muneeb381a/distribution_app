'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Avatar } from '@/components/Avatar';
import { BusyButton, Empty, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { useSettings } from '@/lib/settings';
import { localDay, methodLabel, rupees } from '@dist/shared';

interface Item { label: string; amount: string; note?: string | null; count?: number }
interface Close { id: string; date: string; openingCash: string; cashIn: string; cashOut: string; expected: string; counted: string; difference: string; note: string | null; closedAt: string; closedBy?: string | null }
interface Day {
  date: string;
  bills: { count: number; net: string; udhaar: string };
  cashIn: { total: string; items: Item[] };
  otherIn: { total: string; items: { method: string; amount: string; count: number }[] };
  cashOut: { total: string; items: Item[] };
  previous: { date: string; counted: string } | null;
  openingCash: string | null; expected: string; closed: Close | null;
}
interface Person { key: string; name: string; avatar: string | null; roleName: string | null; bills: number; sales: string; collected: string; cashWithBills: string; receipts: string }

const NOTES = [5000, 1000, 500, 100, 50, 20, 10] as const;
const n = (v: string | number | null | undefined) => Number(v ?? 0);
const shiftDay = (iso: string, by: number) => localDay(new Date(new Date(`${iso}T00:00:00`).getTime() + by * 86_400_000));
const longDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Day end: what came in and went out, what the cash drawer should hold because of it, the count, and the difference.
 * Closing writes the count down; the owner can see every day's difference in one place.
 */
export default function DayEndPage() {
  usePageTitle('Day end');
  const user = useUser();
  const biz = useSettings().businessName;
  const toast = useToast();
  const today = localDay();
  const [date, setDate] = useState(today);
  const [day, setDay] = useState<Day | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [history, setHistory] = useState<Close[]>([]);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [coins, setCoins] = useState('');
  const [typed, setTyped] = useState('');
  const [byTotal, setByTotal] = useState(false);
  const [opening, setOpening] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let stale = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDay(null);
    Promise.all([
      api<Day>(`/day-end?date=${date}`),
      api<{ people: Person[] }>(`/reports/team?from=${date}&to=${date}`).catch(() => ({ people: [] as Person[] })),
      api<Close[]>('/day-end/history?limit=10').catch(() => [] as Close[]),
    ]).then(([d, t, h]) => {
      if (stale) return;
      setDay(d); setPeople(t.people); setHistory(h); setError('');
      setCounts({}); setCoins(''); setOpening('');
      setByTotal(!!d.closed);
      setTyped(d.closed ? String(n(d.closed.counted)) : '');
      setNote(d.closed?.note ?? '');
    }).catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [date, tick]);

  const reload = useCallback(() => setTick((x) => x + 1), []);

  const counted = byTotal ? n(typed) : NOTES.reduce((s, d) => s + d * n(counts[d]), 0) + n(coins);
  const hasCount = byTotal ? typed !== '' : Object.values(counts).some((v) => v) || coins !== '';
  const openingCash = day ? (day.closed ? n(day.closed.openingCash) : day.openingCash !== null ? n(day.openingCash) : n(opening)) : 0;
  const needsOpening = !!day && day.openingCash === null && !day.closed;
  const expected = day ? openingCash + n(day.cashIn.total) - n(day.cashOut.total) : 0;
  const diff = counted - expected;

  const summaryText = useMemo(() => {
    if (!day) return '';
    const lines = [
      `${biz}: day end, ${longDay(day.date)}`,
      `Sales: Rs ${rupees(day.bills.net)} (${day.bills.count} bill${day.bills.count === 1 ? '' : 's'})`,
      `Udhaar given: Rs ${rupees(day.bills.udhaar)}`,
      `Cash in: Rs ${rupees(day.cashIn.total)}${n(day.otherIn.total) ? ` · other money Rs ${rupees(day.otherIn.total)}` : ''}`,
      `Cash out: Rs ${rupees(day.cashOut.total)}`,
      `Drawer should hold: Rs ${rupees(expected)}`,
    ];
    if (day.closed) lines.push(`Counted: Rs ${rupees(day.closed.counted)} (${n(day.closed.difference) === 0 ? 'exact' : n(day.closed.difference) < 0 ? `short Rs ${rupees(Math.abs(n(day.closed.difference)))}` : `over Rs ${rupees(day.closed.difference)}`})`);
    const top = people.filter((p) => n(p.sales) > 0)[0];
    if (top) lines.push(`Top seller: ${top.name}, Rs ${rupees(top.sales)}`);
    return lines.join('\n');
  }, [day, people, expected, biz]);

  if (!user) return null;
  if (!can(user, 'PAYMENT_RECORD')) return <p className="error">You need the payment permission to close the day.</p>;

  async function close(e: FormEvent) {
    e.preventDefault();
    if (!hasCount) { toast.error('Count the cash first'); return; }
    setBusy(true);
    try {
      await api('/day-end', { method: 'PUT', json: { date, counted, ...(needsOpening ? { openingCash: n(opening) } : {}), note: note.trim() || undefined } });
      toast.success(diff === 0 ? 'Day closed. The cash matches.' : `Day closed. ${diff < 0 ? 'Short' : 'Over'} by Rs ${rupees(Math.abs(diff))}.`);
      reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(summaryText); toast.success('Summary copied'); } catch { toast.error('Could not copy'); } };
  const sendWa = () => window.open(`https://wa.me/?text=${encodeURIComponent(summaryText)}`, '_blank', 'noopener');
  const sign = (v: number) => (v === 0 ? 'exact' : v < 0 ? 'short' : 'over');

  return (
    <>
      <div className="page-head">
        <div><h1>Day end</h1><p>Count the cash, see the difference, and close the day.</p></div>
        <div className="de-date">
          <button type="button" className="secondary icon-only" onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day"><Icon name="chevronLeft" /></button>
          <input type="date" aria-label="Day" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button type="button" className="secondary icon-only" disabled={date >= today} onClick={() => setDate(shiftDay(date, 1))} aria-label="Next day"><Icon name="chevronRight" /></button>
          {date !== today && <button type="button" className="secondary" onClick={() => setDate(today)}>Today</button>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!day && !error && <div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}</div>}

      {day && (
        <>
          <div className={`de-status ${day.closed ? 'closed' : 'open'}`}>
            <span className="de-status-icon"><Icon name={day.closed ? 'check' : 'history'} /></span>
            <div>
              <b>{longDay(day.date)}</b>
              <span>{day.closed ? `Closed by ${day.closed.closedBy ?? history.find((h) => h.date.slice(0, 10) === date)?.closedBy ?? 'someone'} at ${new Date(day.closed.closedAt).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}. You can count again and save to correct it.` : date === today ? 'Not closed yet.' : 'This day was never closed.'}</span>
            </div>
            <span className="de-share">
              <button type="button" className="secondary" onClick={copy}><Icon name="copy" />Copy summary</button>
              <button type="button" className="secondary" onClick={sendWa}><Icon name="message" />Send on WhatsApp</button>
            </span>
          </div>

          <StatTiles items={[
            { label: 'Sales', value: <><small>Rs</small>{rupees(day.bills.net)}</>, sub: `${day.bills.count} bill${day.bills.count === 1 ? '' : 's'}`, icon: 'sales' },
            { label: 'Udhaar given', value: <><small>Rs</small>{rupees(day.bills.udhaar)}</>, sub: 'unpaid part of the bills', icon: 'khata', tone: n(day.bills.udhaar) ? 'amber' : 'green' },
            { label: 'Cash in', value: <><small>Rs</small>{rupees(day.cashIn.total)}</>, sub: n(day.otherIn.total) ? `plus Rs ${rupees(day.otherIn.total)} bank / wallet / cheque` : 'all in cash', icon: 'wallet', tone: 'green' },
            { label: 'Cash out', value: <><small>Rs</small>{rupees(day.cashOut.total)}</>, sub: 'expenses, advances, suppliers', icon: 'expenses', tone: n(day.cashOut.total) ? 'red' : 'green' },
          ]} />

          <div className="de-grid">
            <div className="de-col">
              <section className="card">
                <div className="card-head"><h2>Money in</h2><b className="ok">Rs {rupees(day.cashIn.total)}</b></div>
                {day.cashIn.items.length ? (
                  <ul className="list">
                    {day.cashIn.items.map((i) => <li key={i.label}><span className="who-line"><b>{i.label}</b><span>{i.count} {i.count === 1 ? 'entry' : 'entries'}</span></span><span className="amt ok">+ Rs {rupees(i.amount)}</span></li>)}
                  </ul>
                ) : <p className="muted" style={{ margin: 0 }}>No cash came in.</p>}
                {day.otherIn.items.length > 0 && (
                  <div className="de-other">
                    <span className="de-other-head">Not in the drawer</span>
                    {day.otherIn.items.map((m) => <span key={m.method} className="de-other-row"><span>{methodLabel(m.method)} · {m.count}</span><b>Rs {rupees(m.amount)}</b></span>)}
                  </div>
                )}
              </section>

              <section className="card">
                <div className="card-head"><h2>Money out</h2><b className="error">Rs {rupees(day.cashOut.total)}</b></div>
                {day.cashOut.items.length ? (
                  <ul className="list">
                    {day.cashOut.items.map((i, k) => <li key={`${i.label}${k}`}><span className="who-line"><b>{i.label}</b>{(i.note || i.count) && <span>{i.note ?? `${i.count} entr${i.count === 1 ? 'y' : 'ies'}`}</span>}</span><span className="amt">− Rs {rupees(i.amount)}</span></li>)}
                  </ul>
                ) : <p className="muted" style={{ margin: 0 }}>No cash went out.</p>}
              </section>

              <section className="card">
                <div className="card-head"><h2>Who took the money</h2><Link href="/team" className="dx-title-link">Team activity<Icon name="chevronRight" /></Link></div>
                {people.length ? (
                  <ul className="list">
                    {people.map((p) => (
                      <li key={p.key}>
                        <span className="person"><Avatar user={{ username: p.name, displayName: p.name, avatar: p.avatar }} size={34} /><span className="person-text"><b>{p.name}</b><span>{p.bills} bill{p.bills === 1 ? '' : 's'} · sold Rs {rupees(p.sales)}</span></span></span>
                        <span className="de-took"><b>Rs {rupees(p.collected)}</b><span>with bills {rupees(p.cashWithBills)} · khata {rupees(p.receipts)}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : <Empty icon="employees" title="Nobody sold or took money" />}
              </section>
            </div>

            <aside className="de-col de-side">
              <form className="card de-close" onSubmit={close}>
                <div className="card-head"><h2>Cash in the drawer</h2></div>
                <dl className="de-sum">
                  <div><dt>Cash when the day started{day.previous && !day.closed ? <small>from the count on {shortDay(day.previous.date)}</small> : null}</dt>
                    <dd>{needsOpening ? <span className="de-open"><span>Rs</span><input type="number" min="0" step="any" inputMode="decimal" placeholder="0" aria-label="Cash when the day started" value={opening} onChange={(e) => setOpening(e.target.value)} /></span> : `Rs ${rupees(openingCash)}`}</dd></div>
                  <div><dt>+ Cash in</dt><dd className="ok">Rs {rupees(day.cashIn.total)}</dd></div>
                  <div><dt>− Cash out</dt><dd>Rs {rupees(day.cashOut.total)}</dd></div>
                  <div className="de-expected"><dt>Should be in the drawer</dt><dd>Rs {rupees(expected)}</dd></div>
                </dl>

                <div className="de-count-head">
                  <b>What you counted</b>
                  <label className="de-toggle"><input type="checkbox" checked={byTotal} onChange={(e) => setByTotal(e.target.checked)} />I know the total</label>
                </div>
                {byTotal ? (
                  <div className="de-total"><span>Rs</span><input type="number" min="0" step="any" inputMode="decimal" placeholder="0" aria-label="Total counted" value={typed} onChange={(e) => setTyped(e.target.value)} /></div>
                ) : (
                  <div className="de-notes">
                    {NOTES.map((d) => (
                      <label key={d}><span>{d.toLocaleString('en-US')} ×</span><input type="number" min="0" step="1" inputMode="numeric" placeholder="0" aria-label={`Rs ${d} notes`} value={counts[d] ?? ''} onChange={(e) => setCounts({ ...counts, [d]: e.target.value })} /><em>{n(counts[d]) ? `= ${rupees(d * n(counts[d]))}` : ''}</em></label>
                    ))}
                    <label><span>Coins / other</span><input type="number" min="0" step="any" inputMode="decimal" placeholder="0" aria-label="Coins and other cash" value={coins} onChange={(e) => setCoins(e.target.value)} /><em /></label>
                  </div>
                )}

                <div className={`de-result ${hasCount ? sign(diff) : ''}`}>
                  <span>Counted</span><b>Rs {rupees(counted)}</b>
                  <span>Difference</span>
                  <b>{!hasCount ? '—' : diff === 0 ? 'Exact' : `${diff < 0 ? 'Short' : 'Over'} Rs ${rupees(Math.abs(diff))}`}</b>
                </div>

                <label className="de-note">Note (optional)<input maxLength={300} value={note} placeholder="e.g. Rs 80 went on tea, not written down" onChange={(e) => setNote(e.target.value)} /></label>
                <BusyButton busy={busy} className="de-submit" disabled={!hasCount || (needsOpening && opening === '')}><Icon name="check" />{day.closed ? 'Save the new count' : 'Close the day'}</BusyButton>
                {needsOpening && <p className="muted de-hint">There is no earlier count, so enter the cash that was in the drawer this morning.</p>}
              </form>

              <section className="card">
                <div className="card-head"><h2>Recent days</h2></div>
                {history.length ? (
                  <ul className="list de-hist">
                    {history.map((h) => (
                      <li key={h.id}>
                        <button type="button" className="de-hist-btn" onClick={() => setDate(h.date.slice(0, 10))}>
                          <span className="who-line"><b>{shortDay(h.date)}</b><span>counted Rs {rupees(h.counted)}</span></span>
                          <span className={`badge ${n(h.difference) === 0 ? 'green' : n(h.difference) < 0 ? 'red' : 'amber'}`}>{n(h.difference) === 0 ? 'Exact' : `${n(h.difference) < 0 ? 'Short' : 'Over'} ${rupees(Math.abs(n(h.difference)))}`}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted" style={{ margin: 0 }}>No day has been closed yet.</p>}
              </section>
            </aside>
          </div>
        </>
      )}
    </>
  );
}
