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
}
interface CustomerInfo { phone: string | null; area: string | null; address: string | null }

const METHODS = PAYMENT_METHODS.map((m) => [m.value, m.label] as const);
const PAGE = 50;

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
            <h2 style={{ margin: 0 }}>Ledger</h2>
            <span className="count">{entries.length} entries</span>
            <span className="grow" />
            {can(user, 'SALE_CREATE') && <Link className="btn" href={`/sales/new?customer=${id}`}><Icon name="plus" />New bill</Link>}
          </div>
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
              <BusyButton type="submit" busy={busy}>{busy ? 'Saving…' : <><Icon name="print" />Save &amp; print receipt</>}</BusyButton>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
