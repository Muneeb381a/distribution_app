'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { productLabel, useLookups, type ProductOpt } from '@/lib/lookups';

interface Customer { id: string; name: string; shopName: string | null; area: string | null; type: 'CASH' | 'CREDIT'; creditLimit: string | null }
interface Line { productId: string; unitName: string; qty: string; rate: string; reason: string }
interface Collected { productId: string; qty: string }
interface Preview {
  gross: string; returnsCredit: string; net: string; paid: string; previousBalance: string; newBalance: string;
  items: { rate: string; amount: string }[]; returns: { rate: string; amount: string }[];
  credit: { limit: string | null; available: string | null; blocked: string | null };
  empties: { productName: string; given: number; collected: number; heldAfter: number }[];
  shortages: string[];
}
type Priced = { rate: string; amount: string } | undefined;

const blank = (): Line => ({ productId: '', unitName: '', qty: '', rate: '', reason: 'DAMAGED' });
const money = (n: string | number) => Number(n).toLocaleString('en-PK');
const METHODS = [['CASH', 'Cash'], ['BANK', 'Bank'], ['EASYPAISA', 'Easypaisa'], ['JAZZCASH', 'JazzCash']];

export default function NewSalePage() {
  const router = useRouter();
  const user = useUser();
  const { products, locations, error: lookupError } = useLookups();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesmen, setSalesmen] = useState<{ id: string; name: string }[]>([]);
  const [head, setHead] = useState({ saleType: 'COUNTER', customerId: '', locationId: '', salesmanId: '', paidNow: '', method: 'CASH', note: '' });
  const [items, setItems] = useState<Line[]>([blank()]);
  const [returns, setReturns] = useState<Line[]>([]);
  const [collected, setCollected] = useState<Collected[]>([]);
  const [override, setOverride] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // One id per form: if a save is retried after a bad connection, the server returns the same bill.
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    api<Customer[]>('/customers').then(setCustomers).catch((e) => setError(e.message));
    api<{ id: string; name: string }[]>('/employees/options').then(setSalesmen).catch(() => {});
  }, []);

  const prod = (id: string) => products.find((p) => p.id === id);
  const customer = customers.find((c) => c.id === head.customerId);
  const delivery = head.saleType === 'DELIVERY';
  const places = locations.filter((l) => (delivery ? l.type === 'VEHICLE' : l.type !== 'VEHICLE'));
  const returnable = products.filter((p) => p.returnableEmpty);

  const body = useMemo(() => {
    const line = (l: Line) => ({ productId: l.productId, unitName: l.unitName, qty: Number(l.qty), ...(l.rate !== '' ? { rate: Number(l.rate) } : {}) });
    const ok = (l: Line) => l.productId && l.unitName && Number(l.qty) > 0;
    return {
      saleType: head.saleType,
      customerId: head.customerId || undefined,
      locationId: head.locationId,
      salesmanId: head.salesmanId || undefined,
      paidNow: head.paidNow !== '' ? Number(head.paidNow) : undefined,
      method: head.method,
      note: head.note || undefined,
      items: items.filter(ok).map(line),
      returns: returns.filter(ok).map((l) => ({ ...line(l), reason: l.reason })),
      emptiesCollected: collected.filter((c) => c.productId && Number(c.qty) > 0).map((c) => ({ productId: c.productId, qty: Math.round(Number(c.qty)) })),
    };
  }, [head, items, returns, collected]);

  const hasLines = body.items.length > 0 || body.returns.length > 0;

  // Live preview, debounced. The server applies every rule (rates, credit limit, stock), so the screen never guesses.
  useEffect(() => {
    if (!hasLines || !head.locationId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreview(null);
      setPreviewError('');
      return;
    }
    const t = setTimeout(() => {
      api<Preview>('/sales/preview', { method: 'POST', json: body })
        .then((p) => { setPreview(p); setPreviewError(''); })
        .catch((e) => { setPreview(null); setPreviewError(e.message); });
    }, 400);
    return () => clearTimeout(t);
  }, [body, hasLines, head.locationId]);

  const setLine = (set: typeof setItems, list: Line[], i: number, patch: Partial<Line>) => set(list.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (id: string): Partial<Line> => ({ productId: id, unitName: prod(id)?.units[0]?.unitName ?? '', rate: '' });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const bill = await api<{ id: string }>('/sales', { method: 'POST', json: { ...body, clientId, overrideCredit: override || undefined } });
      setClientId(crypto.randomUUID());
      router.push(`/sales/${bill.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const blocked = preview?.credit.blocked;
  const canOverride = can(user, 'CREDIT_OVERRIDE');

  // preview rows line up with the lines that were actually sent (the valid ones)
  const sentPrices = (list: Line[], priced?: { rate: string; amount: string }[]): Priced[] => {
    let k = 0;
    return list.map((l) => (l.productId && l.unitName && Number(l.qty) > 0 ? priced?.[k++] : undefined));
  };

  const lineRow = (l: Line, i: number, list: Line[], set: typeof setItems, isReturn: boolean, priced: Priced[]) => {
    const p: ProductOpt | undefined = prod(l.productId);
    const pr = priced[i];
    return (
      <div className={`line${isReturn ? ' ret' : ''}`} key={i}>
        <select aria-label="Product" value={l.productId} onChange={(e) => setLine(set, list, i, pick(e.target.value))}>
          <option value="">Select product…</option>
          {products.map((x) => <option key={x.id} value={x.id}>{productLabel(x)}</option>)}
        </select>
        <select aria-label="Unit" value={l.unitName} onChange={(e) => setLine(set, list, i, { unitName: e.target.value, rate: '' })} disabled={!p}>
          {p?.units.map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName.toLowerCase()}</option>)}
        </select>
        <input aria-label="Quantity" type="number" step="any" min="0" placeholder="0" value={l.qty} onChange={(e) => setLine(set, list, i, { qty: e.target.value })} />
        <input
          aria-label="Rate" type="number" step="any" min="0" disabled={!can(user, 'RATE_EDIT')} value={l.rate}
          placeholder={pr?.rate ? String(Number(pr.rate)) : 'rate'} onChange={(e) => setLine(set, list, i, { rate: e.target.value })}
        />
        {isReturn && (
          <select aria-label="Reason" value={l.reason} onChange={(e) => setLine(set, list, i, { reason: e.target.value })}>
            <option value="DAMAGED">Damaged</option>
            <option value="EXPIRED">Expired</option>
          </select>
        )}
        <div className={`line-amt${isReturn ? ' neg' : ''}`}>{pr ? `${isReturn ? '-' : ''}${money(pr.amount)}` : '—'}</div>
        <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => set(list.filter((_, j) => j !== i))}>×</button>
      </div>
    );
  };

  const net = preview ? Number(preview.net) : 0;
  const paidShown = head.paidNow !== '' ? Number(head.paidNow) : preview ? Number(preview.paid) : 0;
  const due = Math.max(0, net - paidShown);
  const canSave = !busy && !!preview && (!blocked || override) && !preview.shortages.length;
  const itemPrices = sentPrices(items, preview?.items);
  const returnPrices = sentPrices(returns, preview?.returns);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="no-print" style={{ marginBottom: 6 }}><Link href="/sales">← Back to sales</Link></p>
          <h1>New bill</h1>
        </div>
      </div>
      {(error || lookupError) && <p className="error">{error || lookupError}</p>}

      <form onSubmit={save} className="pos">
        <div className="pos-main">
          <section className="card">
            <div className="step"><span className="step-no">1</span><h2>Sale details</h2></div>
            <div className="seg" role="tablist">
              {[['COUNTER', 'Counter sale'], ['DELIVERY', 'Delivery (vehicle)']].map(([v, l]) => (
                <button type="button" key={v} className={head.saleType === v ? 'on' : ''} onClick={() => setHead({ ...head, saleType: v, locationId: '' })}>{l}</button>
              ))}
            </div>
            <div className="form">
              <label>{delivery ? 'Vehicle' : 'Sold from'}
                <select required value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}>
                  <option value="">Select…</option>
                  {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label>Customer
                <select required={delivery} value={head.customerId} onChange={(e) => setHead({ ...head, customerId: e.target.value })}>
                  <option value="">{delivery ? 'Select…' : 'Walk-in (cash)'}</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.shopName ? ` · ${c.shopName}` : ''}{c.type === 'CREDIT' ? ' (udhaar)' : ''}</option>)}
                </select>
              </label>
              <label>Salesman
                <select required={delivery} value={head.salesmanId} onChange={(e) => setHead({ ...head, salesmanId: e.target.value })}>
                  <option value="">{delivery ? 'Select…' : 'None'}</option>
                  {salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            </div>
            {customer && (
              <div className="cust-chip">
                <div className="avatar">{customer.name.slice(0, 2)}</div>
                <div className="grow">
                  <b>{customer.name}</b>
                  <span>{[customer.shopName, customer.area].filter(Boolean).join(' · ') || 'No shop / area on file'}</span>
                </div>
                <span className={`badge ${customer.type === 'CREDIT' ? 'amber' : 'green'}`}>{customer.type === 'CREDIT' ? 'Udhaar customer' : 'Cash customer'}</span>
                {preview && <span className="badge">Owes Rs {money(preview.previousBalance)}</span>}
              </div>
            )}
          </section>

          <section className="card">
            <div className="step"><span className="step-no">2</span><h2>Items</h2></div>
            <div className="line head"><span>Product</span><span>Unit</span><span>Qty</span><span>Rate</span><span className="r">Amount</span><span /></div>
            {items.map((l, i) => lineRow(l, i, items, setItems, false, itemPrices))}
            <button type="button" className="add-line" onClick={() => setItems([...items, blank()])}><Icon name="plus" />Add another item</button>
          </section>

          <section className="card">
            <div className="step"><span className="step-no alt">+</span><h2>Returns <small>damaged / expired</small></h2></div>
            {returns.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Customer returning damaged or expired stock? It is credited to their khata and moved to damaged stock.</p>
            ) : (
              <div className="line head ret"><span>Product</span><span>Unit</span><span>Qty</span><span>Rate</span><span>Reason</span><span className="r">Credit</span><span /></div>
            )}
            {returns.map((l, i) => lineRow(l, i, returns, setReturns, true, returnPrices))}
            <button type="button" className="add-line" onClick={() => setReturns([...returns, blank()])}><Icon name="plus" />Add a return</button>
          </section>

          {customer && returnable.length > 0 && (
            <section className="card">
              <div className="step"><span className="step-no alt">+</span><h2>Empties collected</h2></div>
              {collected.map((c, i) => (
                <div className="line emp" key={i}>
                  <select aria-label="Product" value={c.productId} onChange={(e) => setCollected(collected.map((x, j) => (j === i ? { ...x, productId: e.target.value } : x)))}>
                    <option value="">Select product…</option>
                    {returnable.map((x) => <option key={x.id} value={x.id}>{productLabel(x)}</option>)}
                  </select>
                  <input aria-label="Empty bottles" type="number" min="1" step="1" placeholder="Empty bottles" value={c.qty} onChange={(e) => setCollected(collected.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                  <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setCollected(collected.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button type="button" className="add-line" onClick={() => setCollected([...collected, { productId: '', qty: '' }])}><Icon name="plus" />Add empties</button>
              {preview?.empties.map((e) => (
                <p key={e.productName} className="muted" style={{ margin: '10px 0 0' }}>{e.productName}: giving {e.given}, collecting {e.collected}, shop will hold {e.heldAfter}</p>
              ))}
            </section>
          )}
        </div>

        <aside className="pos-side">
          <div className="card receipt">
            <h2>Bill summary</h2>
            {previewError && <p className="error">{previewError}</p>}
            {!preview && !previewError && <p className="muted">Choose where to sell from and add items — the total shows here.</p>}
            {preview && (
              <>
                <dl>
                  {customer && <><dt>Previous balance</dt><dd>{money(preview.previousBalance)}</dd></>}
                  <dt>Items</dt><dd>{money(preview.gross)}</dd>
                  {Number(preview.returnsCredit) > 0 && <><dt>Returns credit</dt><dd className="neg">-{money(preview.returnsCredit)}</dd></>}
                </dl>
                <div className="grand"><span>This bill</span><b>Rs {money(preview.net)}</b></div>

                <label className="field" style={{ marginTop: 14 }}>Paid now
                  <input type="number" step="any" min="0" className="paid-input" value={head.paidNow} placeholder={String(Number(preview.paid))} onChange={(e) => setHead({ ...head, paidNow: e.target.value })} />
                </label>
                <div className="quick-pay">
                  <button type="button" className="chip" onClick={() => setHead({ ...head, paidNow: String(net) })}>Full amount</button>
                  {customer?.type === 'CREDIT' && <button type="button" className="chip" onClick={() => setHead({ ...head, paidNow: '0' })}>All udhaar</button>}
                  {head.paidNow !== '' && <button type="button" className="chip" onClick={() => setHead({ ...head, paidNow: '' })}>Reset</button>}
                </div>

                <div className="methods">
                  {METHODS.map(([v, l]) => <button type="button" key={v} className={`chip${head.method === v ? ' on' : ''}`} onClick={() => setHead({ ...head, method: v })}>{l}</button>)}
                </div>

                {customer && (
                  <dl className="after">
                    <dt>Udhaar on this bill</dt><dd className={due > 0 ? 'warn' : ''}>{money(due)}</dd>
                    <dt><b>New balance</b></dt><dd><b>{money(preview.newBalance)}</b></dd>
                    {preview.credit.limit && <><dt className="muted">Limit / available</dt><dd className="muted">{money(preview.credit.limit)} / {money(preview.credit.available ?? 0)}</dd></>}
                  </dl>
                )}
              </>
            )}

            {preview?.shortages.map((s) => <p key={s} className="error">Not enough stock: {s}</p>)}
            {blocked && (
              <p className="error">
                {blocked}
                {canOverride ? (
                  <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Override and save anyway
                  </label>
                ) : ' Ask the owner to approve.'}
              </p>
            )}

            <label className="field" style={{ marginTop: 14 }}>Note
              <input value={head.note} placeholder="Optional" onChange={(e) => setHead({ ...head, note: e.target.value })} />
            </label>
            <button className="save-btn" disabled={!canSave}>{busy ? 'Saving…' : preview ? `Save bill · Rs ${money(preview.net)}` : 'Save bill'}</button>
          </div>
        </aside>
      </form>
    </>
  );
}
