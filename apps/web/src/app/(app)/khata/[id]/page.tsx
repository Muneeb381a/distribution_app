'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { rowLink } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import ChequeFields, { chequeJson, EMPTY_CHEQUE } from '@/components/ChequeFields';
import { CUSTOMER_LEDGER_LABEL, money, PAYMENT_METHODS } from '@dist/shared';

interface Ledger {
  customer: { id: string; name: string; shopName: string | null; type: string; creditLimit: string | null };
  openingBalance: string;
  balance: string;
  entries: { id: string; date: string; refType: string; refId: string; note: string | null; amount: string; balance: string }[];
  emptiesHeld: { productId: string; name: string; held: number }[];
  bills: { saleId: string; billNo: string; date: string; net: string; paid: string; remaining: string; status: 'PAID' | 'PART' | 'UNPAID'; ageDays: number }[];
  openingRemaining: string;
  advance: string;
  receipts: {
    id: string; receiptNo: string; date: string; amount: string; method: string; status: string; chequeNo: string | null; chequeStatus: string | null;
    note: string | null; recordedBy: string | null; applied: { saleId: string | null; billNo: string; amount: string }[]; unallocated: string;
  }[];
}
interface CustomerInfo { phone: string | null; area: string | null; address: string | null }

const METHODS = PAYMENT_METHODS.map((m) => [m.value, m.label] as const);
const PAGE = 50;
const day = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export default function CustomerKhataPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useUser();
  const toast = useToast();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [pay, setPay] = useState({ amount: '', method: 'CASH', note: '' });
  const [cheque, setCheque] = useState(EMPTY_CHEQUE);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [tab, setTab] = useState<'ledger' | 'payments' | 'bills'>('ledger');
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  usePageTitle(ledger ? `${ledger.customer.name} · khata` : null);

  const load = useCallback(() => api<Ledger>(`/khata/${id}`).then(setLedger).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
    api<CustomerInfo>(`/customers/${id}`).then(setInfo).catch(() => {});
  }, [load, id]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ id: string; receiptNo?: string }>('/payments', {
        method: 'POST',
        json: { clientId, customerId: id, amount: Number(pay.amount), method: pay.method, note: pay.note || undefined, ...chequeJson(pay.method, cheque) },
      });
      setClientId(crypto.randomUUID());
      toast.success(`Rs ${money(pay.amount)} received${r.receiptNo ? ` · ${r.receiptNo}` : ''}`);
      router.push(`/receipts/${r.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  // Bills open the bill; payments, cancelled payments and bounced cheques open the receipt.
  const href = (e: Ledger['entries'][number]) => (e.refType === 'SALE' || e.refType === 'SALE_CANCEL' ? `/sales/${e.refId}` : `/receipts/${e.refId}`);
  const balance = Number(ledger?.balance ?? 0);
  const limit = ledger?.customer.creditLimit ? Number(ledger.customer.creditLimit) : null;
  const used = limit ? Math.max(0, balance) / limit : 0;
  const entries = ledger?.entries ?? [];
  const hidden = showAll ? 0 : Math.max(0, entries.length - PAGE);
  const shown = entries.slice(hidden);
  const after = Number(pay.amount) ? balance - Number(pay.amount) : null;
  const openBills = (ledger?.bills ?? []).filter((b) => Number(b.remaining) > 0);
  const openCount = openBills.length + (Number(ledger?.openingRemaining ?? 0) > 0 ? 1 : 0);
  // Which bills this payment would clear, oldest first (what the server will do).
  const plan = (() => {
    let left = Number(pay.amount);
    if (!ledger || !(left > 0)) return [];
    const out: { label: string; amount: number; clears: boolean }[] = [];
    const rows = [...(Number(ledger.openingRemaining) > 0 ? [{ label: 'Old balance', remaining: Number(ledger.openingRemaining) }] : []), ...openBills.map((b) => ({ label: b.billNo, remaining: Number(b.remaining) }))];
    for (const r of rows) {
      if (left <= 0) break;
      const take = Math.min(left, r.remaining);
      out.push({ label: r.label, amount: take, clears: take >= r.remaining });
      left -= take;
    }
    if (left > 0) out.push({ label: 'Advance (for next bill)', amount: left, clears: false });
    return out;
  })();

  if (error && !ledger) return <><Link className="back" href="/khata"><Icon name="chevronLeft" />Khata</Link><p className="error">{error}</p></>;

  return (
    <>
      <Link className="back" href="/khata"><Icon name="chevronLeft" />Khata</Link>
      <div className="doc-grid">
        <div>
          <section className="card">
            {!ledger ? <span className="skeleton" style={{ display: 'block', height: 92 }} /> : (
              <>
                <div className="party">
                  <div className="avatar">{ledger.customer.name.slice(0, 2)}</div>
                  <div className="party-who">
                    <h1>{ledger.customer.name}</h1>
                    <p>
                      {ledger.customer.shopName && <span>{ledger.customer.shopName}</span>}
                      {info?.area && <span>{info.area}</span>}
                      {info?.phone && <a href={`tel:${info.phone}`}>{info.phone}</a>}
                      <span className={`badge ${ledger.customer.type === 'CREDIT' ? 'amber' : 'green'}`}>{ledger.customer.type === 'CREDIT' ? 'Udhaar' : 'Cash'}</span>
                    </p>
                  </div>
                  <Link className="btn secondary no-print party-statement" href={`/khata/${id}/statement`}><Icon name="file" />Statement</Link>
                  <div className="party-bal">
                    <span>{balance > 0 ? 'Owes you' : balance < 0 ? 'In credit' : 'Balance'}</span>
                    <b className={balance > 0 ? 'owe' : balance < 0 ? 'credit' : ''}>Rs {money(Math.abs(balance))}</b>
                  </div>
                </div>
                {limit != null && (
                  <div className="limit">
                    <div className="limit-row">
                      <span>Credit limit used <b>{Math.round(used * 100)}%</b></span>
                      <span>Rs {money(Math.max(0, balance))} of <b>{money(limit)}</b> · {balance > limit ? <b className="error">over by {money(balance - limit)}</b> : <>available <b>{money(limit - Math.max(0, balance))}</b></>}</span>
                    </div>
                    <div className={`meter${used >= 1 ? ' over' : used >= 0.8 ? ' warn' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(used * 100)} aria-label="Credit limit used">
                      <span style={{ width: `${Math.min(100, used * 100)}%` }} />
                    </div>
                  </div>
                )}
                {ledger.emptiesHeld.length > 0 && (
                  <div className="pills">
                    {ledger.emptiesHeld.map((e) => <span key={e.productId} className="badge blue">Holds {e.held} empty {e.name}</span>)}
                  </div>
                )}
              </>
            )}
          </section>

          <div className="list-head">
            <div className="chips" role="tablist" aria-label="Khata views">
              {([['ledger', `Ledger · ${entries.length}`], ['payments', `Payments · ${(ledger?.receipts ?? []).filter((r) => r.status === 'ACTIVE').length}`], ['bills', `Bills owed · ${openCount}`]] as const).map(([v, l]) => (
                <button key={v} type="button" role="tab" aria-selected={tab === v} className={`chip${tab === v ? ' on' : ''}`} onClick={() => setTab(v)}>{l}</button>
              ))}
            </div>
            <span className="grow" />
            {can(user, 'SALE_CREATE') && <Link className="btn" href={`/sales/new?customer=${id}`}><Icon name="plus" />New bill</Link>}
          </div>
          {tab === 'payments' && ledger && (
            <div className="table-wrap">
              <table className="ledger">
                <thead><tr><th>Date</th><th>Receipt</th><th>Method</th><th>Received by</th><th>Paid towards</th><th className="num">Amount</th></tr></thead>
                <tbody>
                  {ledger.receipts.map((r) => (
                    <tr key={r.id} {...rowLink(() => router.push(`/receipts/${r.id}`))} className={`row-link${r.status === 'CANCELLED' ? ' cancel' : ''}`}>
                      <td>{day(r.date)}</td>
                      <td><Link href={`/receipts/${r.id}`}>{r.receiptNo}</Link>{r.status === 'CANCELLED' && <> <span className="badge red">{r.chequeStatus === 'BOUNCED' ? 'Bounced' : 'Cancelled'}</span></>}</td>
                      <td>{r.method.toLowerCase()}{r.chequeNo ? ` · ${r.chequeNo}` : ''}</td>
                      <td>{r.recordedBy ?? ''}</td>
                      <td className="muted">
                        {r.status === 'CANCELLED' ? '' : [...r.applied.map((a) => `${a.billNo} ${money(a.amount)}`), ...(Number(r.unallocated) > 0 ? [`advance ${money(r.unallocated)}`] : [])].join(' · ')}
                      </td>
                      <td className="num amt-credit">{money(r.amount)}</td>
                    </tr>
                  ))}
                  {!ledger.receipts.length && <tr><td colSpan={6}><Empty icon="khata" title="No payments yet" text="Each payment received from this customer shows here with its date." /></td></tr>}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'bills' && ledger && (
            <div className="table-wrap">
              <table className="ledger">
                <thead><tr><th>Bill</th><th>Date</th><th>Age</th><th className="num">Bill total</th><th className="num">Paid</th><th className="num">Left</th><th>Status</th></tr></thead>
                <tbody>
                  {Number(ledger.openingRemaining) > 0 && (
                    <tr><td>Old balance</td><td /><td /><td className="num">{money(ledger.openingBalance)}</td><td className="num">{money(Number(ledger.openingBalance) - Number(ledger.openingRemaining))}</td><td className="num"><b>{money(ledger.openingRemaining)}</b></td><td><span className="badge amber">Brought forward</span></td></tr>
                  )}
                  {[...ledger.bills].filter((b) => b.status !== 'PAID').reverse().map((b) => (
                    <tr key={b.saleId} {...rowLink(() => router.push(`/sales/${b.saleId}`))} className="row-link">
                      <td><Link href={`/sales/${b.saleId}`}>{b.billNo}</Link></td>
                      <td>{day(b.date)}</td>
                      <td className={b.ageDays > 30 ? 'neg' : ''}>{b.ageDays} days</td>
                      <td className="num">{money(b.net)}</td>
                      <td className="num amt-credit">{money(b.paid)}</td>
                      <td className="num"><b>{money(b.remaining)}</b></td>
                      <td><span className={`badge ${b.status === 'PART' ? 'amber' : 'red'}`}>{b.status === 'PART' ? 'Part paid' : 'Unpaid'}</span></td>
                    </tr>
                  ))}
                  {!openCount && <tr><td colSpan={7}><Empty icon="khata" title="Nothing owed" text="Every bill is paid." /></td></tr>}
                </tbody>
              </table>
              {Number(ledger.advance) > 0 && <p className="muted" style={{ margin: '8px 0 0' }}>Rs {money(ledger.advance)} received in advance, it is used on the next bill.</p>}
            </div>
          )}
          {tab === 'ledger' && (
            <>
          {hidden > 0 && (
            <div className="load-more" style={{ margin: '0 0 12px' }}>
              <span className="muted">{hidden} earlier entries hidden</span>
              <button type="button" className="secondary" onClick={() => setShowAll(true)}>Show all</button>
            </div>
          )}
          <div className="table-wrap">
            <table className="ledger">
              <thead><tr><th>Date</th><th>Entry</th><th>Ref</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {!ledger && <SkeletonRows cols={6} />}
                {ledger && hidden === 0 && (
                  <tr className="opening"><td /><td>Opening balance</td><td /><td /><td /><td className="num bal">{money(ledger.openingBalance)}</td></tr>
                )}
                {shown.map((e) => {
                  const amt = Number(e.amount);
                  return (
                    <tr key={e.id} {...rowLink(() => router.push(href(e)))} className={`row-link${e.refType.endsWith('CANCEL') ? ' cancel' : ''}`}>
                      <td>{new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td>{CUSTOMER_LEDGER_LABEL[e.refType] ?? e.refType}</td>
                      <td><Link href={href(e)}>{e.note}</Link></td>
                      <td className="num amt-debit">{amt > 0 ? money(amt) : ''}</td>
                      <td className="num amt-credit">{amt < 0 ? money(-amt) : ''}</td>
                      <td className={`num bal${Number(e.balance) < 0 ? ' amt-credit' : ''}`}>{money(e.balance)}</td>
                    </tr>
                  );
                })}
                {ledger && !entries.length && (
                  <tr><td colSpan={6}><Empty icon="khata" title="No entries yet" text="Bills and payments for this customer show here." /></td></tr>
                )}
              </tbody>
            </table>
          </div>
            </>
          )}
        </div>

        <aside className="doc-side first-on-small">
          {can(user, 'PAYMENT_RECORD') && (
            <form className="card side-form receipt" onSubmit={submit}>
              <h2 style={{ margin: 0 }}>Receive payment</h2>
              <label>Amount (Rs)
                <input className="big" type="number" step="any" min="1" required inputMode="decimal" value={pay.amount} placeholder="0" onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
              </label>
              {balance > 0 && (
                <div className="chips">
                  <button type="button" className="chip" onClick={() => setPay({ ...pay, amount: String(balance) })}>Full balance {money(balance)}</button>
                  {balance > 2000 && <button type="button" className="chip" onClick={() => setPay({ ...pay, amount: String(Math.round(balance / 2)) })}>Half</button>}
                </div>
              )}
              <div>
                <span className="field-label" id="method-label">Method</span>
                <div className="chips" role="radiogroup" aria-labelledby="method-label" style={{ marginTop: 6 }}>
                  {METHODS.map(([v, l]) => (
                    <button type="button" role="radio" aria-checked={pay.method === v} key={v} className={`chip${pay.method === v ? ' on' : ''}`} onClick={() => setPay({ ...pay, method: v })}>{l}</button>
                  ))}
                </div>
              </div>
              {pay.method === 'CHEQUE' && <ChequeFields value={cheque} onChange={setCheque} />}
              <label>Note<input value={pay.note} placeholder="Optional" onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
              {after !== null && (
                <dl className="totals">
                  <dt>Balance now</dt><dd>{money(balance)}</dd>
                  <dt><b>After this payment</b></dt><dd className={after < 0 ? 'good' : ''}><b>{money(after)}</b></dd>
                </dl>
              )}
              {plan.length > 0 && (
                <div className="muted" style={{ fontSize: 13 }}>
                  <b>This pays:</b> {plan.map((x) => `${x.label} ${money(x.amount)}${x.clears ? ' ✓' : ''}`).join(' · ')}
                </div>
              )}
              <BusyButton type="submit" busy={busy}>{busy ? 'Saving…' : <><Icon name="print" />Save &amp; print receipt</>}</BusyButton>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
