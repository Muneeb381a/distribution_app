'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { urdu } from '@/lib/fonts';
import { usePageTitle } from '@/lib/pageTitle';
import { useSettings } from '@/lib/settings';
import { addDays, contactLine, CUSTOMER_LEDGER_LABEL, formatDate, localDay, methodLabel, money, presetRange, unitLabel, waPhone } from '@dist/shared';

interface Entry {
  id: string; date: string; refType: string; refId: string; note: string | null; amount: string; balance: string; ref: string | null;
  method: string | null; chequeNo: string | null; items?: { name: string; qty: string; unitName: string; lineTotal: string }[];
}
interface Statement {
  customer: { id: string; name: string; shopName: string | null; phone: string | null; area: string | null; address: string | null; creditLimit: string | null };
  from: string; to: string; opening: string; debit: string; credit: string; closing: string; entries: Entry[];
}

type Preset = 'month' | 'lastMonth' | '90d' | 'year' | 'custom';
const PRESETS: [Preset, string][] = [['month', 'This month'], ['lastMonth', 'Last month'], ['90d', 'Last 3 months'], ['year', 'This year']];
function rangeOf(p: Preset): [string, string] {
  const now = new Date();
  if (p === '90d') return [localDay(addDays(now, -89)), localDay(now)];
  if (p === 'year') return [`${now.getFullYear()}-01-01`, localDay(now)];
  return presetRange(p === 'custom' ? 'month' : p);
}

/** What a ledger row says in words: "Bill BTL-…", "Payment RCP-… · Easypaisa", "Cheque bounced". */
function particulars(e: Entry) {
  const kind = CUSTOMER_LEDGER_LABEL[e.refType] ?? e.refType;
  if (e.refType === 'PAYMENT') return `${kind} ${e.ref ?? ''}${e.method ? ` · ${methodLabel(e.method)}${e.chequeNo ? ` ${e.chequeNo}` : ''}` : ''}`;
  if (e.refType === 'CHEQUE_BOUNCED') return e.note ?? kind;
  return `${kind} ${e.ref ?? ''}`;
}

/**
 * Customer statement: balance brought forward, each bill (with its items) and payment in the range,
 * and the closing balance. Prints on A4 with the business header; Save as PDF to send on WhatsApp.
 */
export default function StatementPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const biz = useSettings();
  const [preset, setPreset] = useState<Preset>('month');
  const [[from, to], setRange] = useState<[string, string]>(() => {
    const f = search.get('from'), t = search.get('to');
    return f && t ? [f, t] : rangeOf('month');
  });
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState(true);
  usePageTitle(data ? `Statement · ${data.customer.name}` : null);

  useEffect(() => {
    let stale = false;
    api<Statement>(`/khata/${id}/statement?from=${from}&to=${to}`)
      .then((d) => { if (!stale) { setData(d); setError(''); } })
      .catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [id, from, to]);

  const pick = (p: Preset) => { setPreset(p); setData(null); setRange(rangeOf(p)); };
  const setDates = (f: string, t: string) => { setPreset('custom'); setData(null); setRange([f, t]); };

  function whatsapp() {
    if (!data) return;
    const lines = [
      `*${biz.businessName}* — statement`,
      `${data.customer.name}${data.customer.shopName ? ` (${data.customer.shopName})` : ''}`,
      `${formatDate(data.from)} to ${formatDate(data.to)}`,
      '',
      `Brought forward: Rs ${money(data.opening)}`,
      ...data.entries.map((e) => `${formatDate(e.date, 'short')}  ${particulars(e)}  ${Number(e.amount) > 0 ? '+' : '−'}${money(Math.abs(Number(e.amount)))}`),
      '',
      `Bills: Rs ${money(data.debit)} · Received: Rs ${money(data.credit)}`,
      `*Balance: Rs ${money(data.closing)}*`,
    ];
    window.open(`https://wa.me/${waPhone(data.customer.phone)}?text=${encodeURIComponent(lines.join('\n'))}`, '_blank', 'noopener');
  }

  const owes = Number(data?.closing ?? 0);

  return (
    <>
      <div className="no-print">
        <Link className="back" href={`/khata/${id}`}><Icon name="chevronLeft" />{data?.customer.name ?? 'Khata'}</Link>
        <div className="page-head">
          <div><h1>Statement</h1><p>Everything between two dates, with the balance carried in and out.</p></div>
          <div className="actions">
            <button type="button" className="secondary" disabled={!data} onClick={whatsapp}><Icon name="share" />WhatsApp</button>
            <button type="button" disabled={!data} onClick={() => window.print()}><Icon name="print" />Print / PDF</button>
          </div>
        </div>
        <div className="filters">
          <div className="chips">
            {PRESETS.map(([p, l]) => <button key={p} type="button" className={`chip${preset === p ? ' on' : ''}`} aria-pressed={preset === p} onClick={() => pick(p)}>{l}</button>)}
          </div>
          <div className="date-range">
            <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setDates(e.target.value, to)} />
            <span className="muted">to</span>
            <input type="date" aria-label="To" value={to} min={from} max={localDay()} onChange={(e) => setDates(from, e.target.value)} />
          </div>
          <label className="check-inline"><input type="checkbox" checked={items} onChange={(e) => setItems(e.target.checked)} />Show bill items</label>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <article className="card paper statement">
        <header className="st-head">
          <div>
            {biz.urduName && <div className={`st-urdu ${urdu.className}`} dir="rtl">{biz.urduName}</div>}
            <b className="st-biz">{biz.businessName}</b>
            {contactLine(biz) && <div className="st-contact">{contactLine(biz)}</div>}
          </div>
          <div className="st-title">
            <span>Account statement</span>
            <b>{formatDate(from)} – {formatDate(to)}</b>
          </div>
        </header>

        {data && (
          <div className="st-party">
            <div>
              <span className="st-label">Customer</span>
              <b>{data.customer.name}</b>
              <div>{[data.customer.shopName, data.customer.area, data.customer.phone].filter(Boolean).join(' · ')}</div>
            </div>
            <dl className="st-sum">
              <div><dt>Brought forward</dt><dd>{money(data.opening)}</dd></div>
              <div><dt>Bills</dt><dd>+{money(data.debit)}</dd></div>
              <div><dt>Received</dt><dd>−{money(data.credit)}</dd></div>
              <div className="st-close"><dt>{owes >= 0 ? 'Balance due' : 'In credit'}</dt><dd>Rs {money(Math.abs(owes))}</dd></div>
            </dl>
          </div>
        )}

        <div className="table-wrap st-wrap">
        <table className="ledger st-table">
          <thead><tr><th>Date</th><th>Particulars</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
          <tbody>
            {!data && !error && <SkeletonRows cols={5} rows={6} />}
            {data && (
              <tr className="opening"><td>{formatDate(data.from, 'short')}</td><td>Balance brought forward</td><td /><td /><td className="num bal">{money(data.opening)}</td></tr>
            )}
            {data?.entries.map((e) => {
              const amt = Number(e.amount);
              return (
                <tr key={e.id} className={e.refType.endsWith('CANCEL') || e.refType === 'CHEQUE_BOUNCED' ? 'cancel' : ''}>
                  <td>{formatDate(e.date, 'short')}</td>
                  <td>
                    <Link className="st-ref" href={e.refType.startsWith('SALE') ? `/sales/${e.refId}` : `/receipts/${e.refId}`}>{particulars(e)}</Link>
                    {items && e.items && (
                      <ul className="st-items">
                        {e.items.map((i, k) => <li key={k}>{i.name} — {Number(i.qty)} {unitLabel(i.unitName)} <span>{money(i.lineTotal)}</span></li>)}
                      </ul>
                    )}
                  </td>
                  <td className="num">{amt > 0 ? money(amt) : ''}</td>
                  <td className="num">{amt < 0 ? money(-amt) : ''}</td>
                  <td className="num bal">{money(e.balance)}</td>
                </tr>
              );
            })}
            {data && !data.entries.length && <tr><td /><td className="muted" colSpan={4}>No bills or payments in these dates.</td></tr>}
            {data && (
              <tr className="total-row"><td /><td>Closing balance</td><td className="num">{money(data.debit)}</td><td className="num">{money(data.credit)}</td><td className="num">{money(data.closing)}</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <footer className="st-foot">
          <span>Printed {formatDate(new Date(), 'datetime')}</span>
          {biz.footer && <span className={urdu.className} dir="rtl">{biz.footer}</span>}
        </footer>
      </article>
    </>
  );
}
