'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Combobox from '@/components/Combobox';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { productOptions, useLookups } from '@/lib/lookups';
import { usePageTitle } from '@/lib/pageTitle';

interface Ledger {
  supplier: { id: string; name: string; phone?: string | null; type?: string };
  openingBalance: string;
  balance: string;
  entries: { id: string; date: string; refType: string; note: string | null; amount: string; balance: string }[];
}

const LABEL: Record<string, string> = { PURCHASE: 'Purchase', PAYMENT: 'Payment', RETURN: 'Return', CANCEL: 'Cancelled purchase' };
const METHODS: [string, string][] = [['CASH', 'Cash'], ['BANK', 'Bank'], ['EASYPAISA', 'Easypaisa'], ['JAZZCASH', 'JazzCash']];
const money = (n: string | number) => Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 });

export default function SupplierLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const toast = useToast();
  const { products, locations } = useLookups();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [pay, setPay] = useState({ amount: '', method: 'CASH', note: '' });
  const [ret, setRet] = useState({ locationId: '', productId: '', unitName: '', qty: '', unitPrice: '', fromStatus: 'DAMAGED', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'' | 'pay' | 'ret'>('');

  usePageTitle(ledger ? `${ledger.supplier.name} · ledger` : null);
  const productOpts = useMemo(() => productOptions(products), [products]);

  const load = useCallback(() => api<Ledger>(`/suppliers/${id}/ledger`).then(setLedger).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function post(kind: 'pay' | 'ret', path: string, json: unknown, done: string) {
    setBusy(kind);
    try {
      await api(path, { method: 'POST', json });
      toast.success(done);
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function submitPay(e: FormEvent) {
    e.preventDefault();
    if (await post('pay', '/supplier-payments', { supplierId: id, amount: Number(pay.amount), method: pay.method, note: pay.note || undefined }, `Paid Rs ${money(pay.amount)} to ${ledger?.supplier.name}`)) {
      setPay({ ...pay, amount: '', note: '' });
    }
  }

  async function submitReturn(e: FormEvent) {
    e.preventDefault();
    const ok = await post('ret', '/purchase-returns', {
      supplierId: id,
      locationId: ret.locationId,
      note: ret.note || undefined,
      items: [{ productId: ret.productId, unitName: ret.unitName, qty: Number(ret.qty), unitPrice: Number(ret.unitPrice), fromStatus: ret.fromStatus }],
    }, 'Return recorded');
    if (ok) setRet({ ...ret, qty: '', unitPrice: '', note: '' });
  }

  const owed = Number(ledger?.balance ?? 0);
  const entries = ledger?.entries ?? [];
  const sum = (f: (a: number, t: string) => boolean) => entries.reduce((s, e) => (f(Number(e.amount), e.refType) ? s + Math.abs(Number(e.amount)) : s), 0);
  const purchased = sum((a, t) => a > 0 && t === 'PURCHASE');
  const paid = sum((_, t) => t === 'PAYMENT');
  const returned = sum((_, t) => t === 'RETURN');
  const retProduct = products.find((p) => p.id === ret.productId);

  if (error && !ledger) return <><Link className="back" href="/suppliers"><Icon name="chevronLeft" />Suppliers</Link><p className="error">{error}</p></>;

  return (
    <>
      <Link className="back" href="/suppliers"><Icon name="chevronLeft" />Suppliers</Link>
      <section className="card">
        {!ledger ? <span className="skeleton" style={{ display: 'block', height: 60 }} /> : (
          <div className="party">
            <div className="avatar">{ledger.supplier.name.slice(0, 2)}</div>
            <div className="party-who">
              <h1>{ledger.supplier.name}</h1>
              <p><span>Supplier ledger</span><span>Opening balance {money(ledger.openingBalance)}</span></p>
            </div>
            <div className="party-bal">
              <span>{owed > 0 ? 'We owe them' : owed < 0 ? 'They owe us' : 'Balance'}</span>
              <b className={owed > 0 ? 'owe' : owed < 0 ? 'credit' : ''}>Rs {money(Math.abs(owed))}</b>
            </div>
          </div>
        )}
      </section>

      <div className="mini-stats">
        <div className="stat"><span className="label"><span className="icon"><Icon name="purchases" /></span>Purchased</span><span className="value"><small>Rs</small>{money(purchased)}</span></div>
        <div className="stat"><span className="label"><span className="icon green"><Icon name="wallet" /></span>Paid</span><span className="value"><small>Rs</small>{money(paid)}</span></div>
        <div className="stat"><span className="label"><span className="icon amber"><Icon name="refresh" /></span>Returned</span><span className="value"><small>Rs</small>{money(returned)}</span></div>
      </div>

      <div className="doc-grid">
        <div>
          <h2 style={{ marginTop: 0 }}>Ledger</h2>
          <div className="table-wrap">
            <table className="ledger">
              <thead><tr><th>Date</th><th>Entry</th><th>Note</th><th className="num">We owe more</th><th className="num">We owe less</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {!ledger && <SkeletonRows cols={6} />}
                {ledger && <tr className="opening"><td /><td>Opening balance</td><td /><td /><td /><td className="num bal">{money(ledger.openingBalance)}</td></tr>}
                {entries.map((e) => {
                  const a = Number(e.amount);
                  return (
                    <tr key={e.id} className={e.refType === 'CANCEL' ? 'cancel' : ''}>
                      <td>{new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td>{LABEL[e.refType] ?? e.refType}</td>
                      <td className="muted">{e.note}</td>
                      <td className="num amt-debit">{a > 0 ? money(a) : ''}</td>
                      <td className="num amt-credit">{a < 0 ? money(-a) : ''}</td>
                      <td className="num bal">{money(e.balance)}</td>
                    </tr>
                  );
                })}
                {ledger && !entries.length && <tr><td colSpan={6}><Empty icon="suppliers" title="No entries yet" text="Purchases, payments and returns show here." action={<Link className="btn" href="/purchases">Record a purchase</Link>} /></td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="doc-side">
          {can(user, 'SUPPLIER_PAYMENT') && (
            <form className="card side-form receipt" onSubmit={submitPay}>
              <h2 style={{ margin: 0 }}>Pay supplier</h2>
              <label>Amount (Rs)<input className="big" type="number" step="any" min="1" required inputMode="decimal" placeholder="0" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
              {owed > 0 && <div className="chips"><button type="button" className="chip" onClick={() => setPay({ ...pay, amount: String(owed) })}>Full {money(owed)}</button></div>}
              <div>
                <span className="field-label" id="sp-method">Method</span>
                <div className="chips" role="radiogroup" aria-labelledby="sp-method" style={{ marginTop: 6 }}>
                  {METHODS.map(([v, l]) => <button type="button" role="radio" aria-checked={pay.method === v} key={v} className={`chip${pay.method === v ? ' on' : ''}`} onClick={() => setPay({ ...pay, method: v })}>{l}</button>)}
                </div>
              </div>
              <label>Note<input value={pay.note} placeholder="Optional" onChange={(e) => setPay({ ...pay, note: e.target.value })} /></label>
              <BusyButton type="submit" busy={busy === 'pay'}>Record payment</BusyButton>
            </form>
          )}
          {can(user, 'PURCHASE_MANAGE') && (
            <form className="card side-form" onSubmit={submitReturn}>
              <h2 style={{ margin: 0 }}>Return to supplier</h2>
              <p className="card-sub" style={{ margin: 0 }}>Sends stock back and reduces what we owe.</p>
              <label>Return from
                <select required value={ret.locationId} onChange={(e) => setRet({ ...ret, locationId: e.target.value })}>
                  <option value="">Select location…</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <div className="seg" role="radiogroup" aria-label="Stock" style={{ margin: 0 }}>
                {[['DAMAGED', 'Damaged stock'], ['OK', 'Saleable stock']].map(([v, l]) => (
                  <button type="button" key={v} role="radio" aria-checked={ret.fromStatus === v} className={ret.fromStatus === v ? 'on' : ''} onClick={() => setRet({ ...ret, fromStatus: v })}>{l}</button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="ret-product">Product</label>
                <Combobox id="ret-product" required compact options={productOpts} value={ret.productId} recentKey="product" placeholder="Type product name…"
                  onChange={(v) => setRet({ ...ret, productId: v, unitName: products.find((p) => p.id === v)?.units[0]?.unitName ?? '' })} />
              </div>
              <div className="two">
                <label>Unit
                  <select required value={ret.unitName} disabled={!retProduct} onChange={(e) => setRet({ ...ret, unitName: e.target.value })}>
                    {retProduct?.units.map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName.toLowerCase()}</option>)}
                  </select>
                </label>
                <label>Qty<input type="number" step="any" min="0" required inputMode="decimal" value={ret.qty} onChange={(e) => setRet({ ...ret, qty: e.target.value })} /></label>
              </div>
              <label>Credit per unit (Rs)<input type="number" step="any" min="0" required inputMode="decimal" value={ret.unitPrice} onChange={(e) => setRet({ ...ret, unitPrice: e.target.value })} /></label>
              {Number(ret.qty) > 0 && Number(ret.unitPrice) > 0 && <p className="muted" style={{ margin: 0 }}>Credit: <b>Rs {money(Number(ret.qty) * Number(ret.unitPrice))}</b></p>}
              <BusyButton type="submit" className="secondary" busy={busy === 'ret'}>Return to supplier</BusyButton>
            </form>
          )}
        </aside>
      </div>
    </>
  );
}
