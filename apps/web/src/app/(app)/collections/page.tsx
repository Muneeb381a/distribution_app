'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '@/components/Avatar';
import { Empty, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { useSettings } from '@/lib/settings';
import { rupees } from '@dist/shared';

interface Due {
  id: string; name: string; shopName: string | null; area: string | null; phone: string | null;
  balance: string; creditLimit: string | null; overLimit: boolean; oldestDays: number | null;
  buckets: { d30: string; d60: string; d90: string; older: string; brought: string };
  lastPaid: { date: string; amount: string } | null;
  lastReminded: { at: string; channel: string } | null;
}
interface Dues {
  rows: Due[];
  totals: { customers: number; due: string; d30: string; d60: string; d90: string; older: string; brought: string };
}

type Age = 'all' | '30' | '60' | '90';
type Lang = 'ur' | 'en';
const n = (v: string | number) => Number(v);
const LANG_KEY = 'dist.reminderLang';

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
const agoText = (iso: string) => { const d = daysSince(iso); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };

/** A Pakistani mobile number as WhatsApp wants it: country code, no zeros, no dashes. */
function waNumber(phone: string | null) {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length < 10) return null;
  if (d.startsWith('92')) return d;
  if (d.startsWith('0')) return `92${d.slice(1)}`;
  return d.length === 10 ? `92${d}` : d;
}

function messageFor(lang: Lang, biz: string, c: Due) {
  const amt = rupees(c.balance);
  const old = c.oldestDays !== null && c.oldestDays > 0 ? c.oldestDays : null;
  if (lang === 'ur') {
    return `السلام علیکم ${c.name} صاحب،\n${biz} کی طرف سے یاد دہانی: آپ کے ذمے Rs ${amt} باقی ہیں${old ? ` (سب سے پرانا بل ${old} دن پرانا ہے)` : ''}۔\nبراہِ مہربانی جلد ادائیگی فرما دیں۔ شکریہ۔`;
  }
  return `Assalam o Alaikum ${c.name},\nA gentle reminder from ${biz}: Rs ${amt} is outstanding${old ? ` (the oldest bill is ${old} days old)` : ''}.\nPlease arrange the payment at your earliest convenience. Thank you.`;
}

const tone = (days: number | null) => (days === null ? '' : days > 90 ? 'red' : days > 60 ? 'amber' : days > 30 ? 'amber' : 'green');

/**
 * Collections: who owes money, how old it is, and a one-tap WhatsApp or call to ask for it.
 * The list is ordered by how long the oldest bill has been waiting, so the top of the page is who to chase first.
 */
export default function CollectionsPage() {
  usePageTitle('Collections');
  const user = useUser();
  const biz = useSettings().businessName;
  const toast = useToast();
  const [data, setData] = useState<Dues | null>(null);
  const [error, setError] = useState('');
  const [age, setAge] = useState<Age>('all');
  const [area, setArea] = useState('');
  const [text, setText] = useState('');
  const [fresh, setFresh] = useState(false);
  const [lang, setLang] = useState<Lang>('ur');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(LANG_KEY) === 'en') setLang('en');
    api<Dues>('/khata/dues').then(setData).catch((e) => setError(e.message));
  }, []);

  const areas = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r.area).filter(Boolean) as string[])].sort(), [data]);
  const rows = useMemo(() => {
    const f = text.trim().toLowerCase();
    return (data?.rows ?? []).filter((r) =>
      (age === 'all' || (r.oldestDays ?? 0) > Number(age))
      && (!area || r.area === area)
      && (!fresh || !r.lastReminded || daysSince(r.lastReminded.at) >= 7)
      && (!f || `${r.name} ${r.shopName ?? ''} ${r.area ?? ''} ${r.phone ?? ''}`.toLowerCase().includes(f)));
  }, [data, age, area, text, fresh]);

  if (!user) return null;
  if (!can(user, 'PAYMENT_RECORD')) return <p className="error">You need the payment permission to see collections.</p>;

  const t = data?.totals;
  const old30 = t ? n(t.d60) + n(t.d90) + n(t.older) : 0;
  const never = (data?.rows ?? []).filter((r) => !r.lastReminded).length;
  const segs = t ? [
    { k: 'd30', label: '0–30 days', v: n(t.d30), c: 'var(--success)' },
    { k: 'd60', label: '31–60 days', v: n(t.d60), c: 'var(--warn)' },
    { k: 'd90', label: '61–90 days', v: n(t.d90), c: '#f97316' },
    { k: 'older', label: 'Over 90 days', v: n(t.older), c: 'var(--danger)' },
    { k: 'brought', label: 'Old register balance', v: n(t.brought), c: 'var(--faint)' },
  ] : [];
  const total = segs.reduce((s, x) => s + x.v, 0) || 1;

  function pickLang(l: Lang) { setLang(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ } }

  async function logReminder(c: Due, channel: 'WHATSAPP' | 'CALL') {
    try {
      await api(`/khata/${c.id}/reminders`, { method: 'POST', json: { channel } });
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === c.id ? { ...r, lastReminded: { at: new Date().toISOString(), channel } } : r)) } : d));
    } catch { /* the message still opens; only the note is missed */ }
  }
  function whatsapp(c: Due) {
    const num = waNumber(c.phone);
    if (!num) return;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(messageFor(lang, biz, c))}`, '_blank', 'noopener');
    void logReminder(c, 'WHATSAPP');
  }
  async function copy(c: Due) {
    try { await navigator.clipboard.writeText(messageFor(lang, biz, c)); toast.success('Message copied. Paste it into SMS or any chat.'); } catch { toast.error('Could not copy'); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Collections</h1><p>Who owes you money, how old it is, and who to chase first.</p></div>
        <div className="seg" role="radiogroup" aria-label="Message language" style={{ margin: 0 }}>
          <button type="button" role="radio" aria-checked={lang === 'ur'} className={lang === 'ur' ? 'on' : ''} onClick={() => pickLang('ur')}>اردو message</button>
          <button type="button" role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => pickLang('en')}>English message</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {!data && !error && <div className="stats">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 112 }} />)}</div>}

      {data && t && (
        <>
          <StatTiles items={[
            { label: 'To collect', value: <><small>Rs</small>{rupees(t.due)}</>, sub: `from ${t.customers} customer${t.customers === 1 ? '' : 's'}`, icon: 'khata', tone: 'amber' },
            { label: 'Over 30 days old', value: <><small>Rs</small>{rupees(old30)}</>, sub: old30 ? `${pctOf(old30, n(t.due))}% of what is owed` : 'nothing is overdue', icon: 'alert', tone: old30 ? 'red' : 'green' },
            { label: 'Customers over limit', value: data.rows.filter((r) => r.overLimit).length, sub: 'above their credit limit', icon: 'ban', tone: data.rows.some((r) => r.overLimit) ? 'red' : 'green' },
            { label: 'Never reminded', value: never, sub: never ? 'nobody has asked them yet' : 'everyone has been reminded', icon: 'message', tone: never ? 'amber' : 'green' },
          ]} />

          {t.customers > 0 && (
            <section className="card co-age">
              <div className="card-head"><h2>How old is the money owed</h2></div>
              <div className="co-bar" role="img" aria-label={segs.map((s) => `${s.label} Rs ${rupees(s.v)}`).join(', ')}>
                {segs.filter((s) => s.v > 0).map((s) => <span key={s.k} style={{ flex: s.v / total, background: s.c }} title={`${s.label}: Rs ${rupees(s.v)}`} />)}
              </div>
              <ul className="co-legend">
                {segs.map((s) => <li key={s.k}><i style={{ background: s.c }} /><span>{s.label}</span><b>Rs {rupees(s.v)}</b></li>)}
              </ul>
            </section>
          )}

          <div className="list-head">
            <div className="filter"><Icon name="search" /><input aria-label="Search customers" placeholder="Search name, shop, area, phone…" value={text} onChange={(e) => setText(e.target.value)} /></div>
            <div className="chips" role="group" aria-label="Age">
              {([['all', 'Everyone'], ['30', 'Over 30 days'], ['60', 'Over 60 days'], ['90', 'Over 90 days']] as [Age, string][]).map(([v, l]) => (
                <button key={v} type="button" className={`chip${age === v ? ' on' : ''}`} data-tone={v === '90' ? 'red' : v === '60' || v === '30' ? 'amber' : undefined} aria-pressed={age === v} onClick={() => setAge(v)}>{l}</button>
              ))}
              <button type="button" className={`chip${fresh ? ' on' : ''}`} aria-pressed={fresh} onClick={() => setFresh(!fresh)} title="Hide customers who were reminded in the last 7 days">Not reminded this week</button>
            </div>
            {areas.length > 1 && (
              <select aria-label="Area" value={area} onChange={(e) => setArea(e.target.value)}>
                <option value="">All areas</option>
                {areas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
          </div>

          {!rows.length ? (
            <Empty icon="khata" title={data.rows.length ? 'Nobody matches these filters' : 'Nobody owes you anything'} text={data.rows.length ? 'Try a different age or clear the search.' : 'Every customer is clear.'} />
          ) : (
            <ul className="co-list">
              {rows.map((c, i) => {
                const phone = waNumber(c.phone);
                const days = c.oldestDays;
                const sinceRem = c.lastReminded ? daysSince(c.lastReminded.at) : null;
                return (
                  <li key={c.id} className="card co-row" style={{ ['--i' as string]: Math.min(i, 12) }}>
                    <Link href={`/khata/${c.id}`} className="co-who">
                      <Avatar user={{ username: c.name }} size={44} />
                      <span className="co-name">
                        <b>{c.name}{c.overLimit && <span className="badge red">Over limit</span>}</b>
                        <span>{[c.shopName, c.area].filter(Boolean).join(' · ') || 'No shop or area saved'}</span>
                      </span>
                    </Link>
                    <span className="co-amt">
                      <b>Rs {rupees(c.balance)}</b>
                      <span className={`badge ${tone(days)}`}>{days === null ? 'old register balance' : days === 0 ? 'bill from today' : `oldest bill ${days} days`}</span>
                    </span>
                    <span className="co-facts">
                      <span><Icon name="wallet" />{c.lastPaid ? <>Paid Rs {rupees(c.lastPaid.amount)} · {agoText(c.lastPaid.date)}</> : <span className="muted">Never paid yet</span>}</span>
                      <span className={sinceRem === null ? 'warnc' : ''}><Icon name="message" />{c.lastReminded ? `Reminded ${agoText(c.lastReminded.at)} (${c.lastReminded.channel === 'CALL' ? 'call' : 'WhatsApp'})` : 'Not reminded yet'}</span>
                    </span>
                    <span className="co-actions">
                      <button type="button" className="wa" disabled={!phone} onClick={() => whatsapp(c)} title={phone ? 'Open WhatsApp with the message ready' : 'No phone number saved for this customer'}><Icon name="message" />WhatsApp</button>
                      {phone ? <a className="btn secondary" href={`tel:+${phone}`} onClick={() => void logReminder(c, 'CALL')} aria-label={`Call ${c.name}`} title="Call"><Icon name="phone" /></a> : <span className="muted co-nophone">No phone</span>}
                      <button type="button" className="secondary icon-only" onClick={() => copy(c)} aria-label="Copy the message" title="Copy the message"><Icon name="copy" /></button>
                      <Link className="btn secondary" href={`/khata/${c.id}`}>Khata<Icon name="chevronRight" /></Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted co-note">Pressing WhatsApp opens the chat with the message already written, you press Send. The app notes who was reminded and when, so two people do not chase the same customer.</p>
        </>
      )}
    </>
  );
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
