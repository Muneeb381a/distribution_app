'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Combobox from '@/components/Combobox';
import DocPrintDialog from '@/components/DocPrintDialog';
import { BusyButton, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { readBillDefaults, rememberBillDefaults } from '@/lib/billDefaults';
import { api, can, useUser } from '@/lib/api';
import { customerOptions, productOptions, useLookups, type ProductOpt } from '@/lib/lookups';
import { getSnapshot, isNetworkError, previewOffline, saveSaleOffline, useSyncState, type OutboxOp, type Preview, type Snapshot } from '@/lib/offline';
import type { PrintMode } from '@/components/PrintPanel';
import { money, BILL_PAYMENT_METHODS, RETURN_REASONS, unitLabel } from '@dist/shared';

interface Customer { id: string; name: string; shopName: string | null; area: string | null; phone: string | null; type: 'CASH' | 'CREDIT'; creditLimit: string | null }
interface LastBill { id: string; billNo: string; date: string; net: string; rates: Record<string, string>; items: { productId: string; unitName: string; qty: string }[] }
interface Saved { id: string | null; billNo: string; net: string; offline?: OutboxOp }
interface Line { productId: string; unitName: string; qty: string; rate: string; reason: string }
interface Collected { productId: string; qty: string }
type Priced = { rate: string; amount: string } | undefined;

const blank = (): Line => ({ productId: '', unitName: '', qty: '', rate: '', reason: 'DAMAGED' });
// Cheques are taken on the khata page, where they can later be cleared or bounced.
const METHODS = BILL_PAYMENT_METHODS.map((m) => [m.value, m.label] as const);

export default function NewSalePage() {
  const search = useSearchParams();
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const sync = useSyncState();
  const offline = !sync.reachable;
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [printing, setPrinting] = useState<PrintMode | null>(null);
  const lookups = useLookups();
  const [onlineCustomers, setCustomers] = useState<Customer[]>([]);
  const [onlineSalesmen, setSalesmen] = useState<{ id: string; name: string }[]>([]);
  // Offline (or before the server answers), the screen works from the last snapshot saved on this PC.
  const fromSnap = offline && !!snap;
  const products: ProductOpt[] = fromSnap ? snap.products : lookups.products;
  const locations = fromSnap ? snap.locations : lookups.locations;
  const customers: Customer[] = fromSnap ? snap.customers : onlineCustomers;
  const salesmen = fromSnap ? snap.salesmen : onlineSalesmen;
  const lookupError = offline ? '' : lookups.error;
  // ?location=<vehicle>&salesman=<id> (from a vehicle trip) starts a delivery bill from that vehicle.
  const [head, setHead] = useState({
    saleType: search.get('location') ? 'DELIVERY' : 'COUNTER', customerId: search.get('customer') ?? '', locationId: search.get('location') ?? '',
    salesmanId: search.get('salesman') ?? '', paidNow: '', method: 'CASH', note: '',
  });
  const [lastBill, setLastBill] = useState<LastBill | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
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
    api<Customer[]>('/customers').then(setCustomers).catch((e) => { if (!isNetworkError(e)) setError(e.message); });
    api<{ id: string; name: string }[]>('/employees/options').then(setSalesmen).catch(() => {});
  }, []);
  useEffect(() => {
    getSnapshot().then(setSnap);
  }, [offline, sync.snapshotAt]);

  // Start from where this user last billed (location and salesman), unless the link says otherwise.
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (defaultsApplied.current || !user || !locations.length || search.get('location')) return;
    defaultsApplied.current = true;
    const d = readBillDefaults(user.id)[head.saleType as 'COUNTER' | 'DELIVERY'];
    if (!d) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHead((h) => ({
      ...h,
      locationId: h.locationId || (d.locationId && locations.some((l) => l.id === d.locationId) ? d.locationId : ''),
      salesmanId: h.salesmanId || (d.salesmanId && salesmen.some((x) => x.id === d.salesmanId) ? d.salesmanId : ''),
    }));
  }, [user, locations, salesmen, search, head.saleType]);

  // Last bill of the chosen customer, for the "last rate" hints.
  useEffect(() => {
    if (!head.customerId) return;
    let stale = false;
    api<{ id: string }[]>(`/sales?customerId=${head.customerId}&status=ACTIVE&limit=1`)
      .then(async ([b]) => {
        if (!b) return null;
        const full = await api<{ id: string; billNo: string; date: string; net: string; items: { productId: string; unitName: string; qty: string; rate: string }[] }>(`/sales/${b.id}`);
        return {
          id: full.id, billNo: full.billNo, date: full.date, net: full.net, rates: Object.fromEntries(full.items.map((i) => [`${i.productId}|${i.unitName}`, i.rate])),
          items: full.items.map((i) => ({ productId: i.productId, unitName: i.unitName, qty: String(Number(i.qty)) })),
        };
      })
      .then((lb) => { if (!stale) setLastBill(lb); })
      .catch(() => { if (!stale) setLastBill(null); });
    return () => { stale = true; };
  }, [head.customerId]);

  // Move focus after the line list re-renders (new line added, product picked…).
  useEffect(() => {
    if (!focusTarget) return;
    formRef.current?.querySelector<HTMLElement>(focusTarget)?.focus();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusTarget(null);
  }, [focusTarget, items, returns]);

  const customerOpts = useMemo(() => customerOptions(customers), [customers]);
  const productOpts = useMemo(() => productOptions(products), [products]);
  const prod = (id: string) => products.find((p) => p.id === id);
  const customer = customers.find((c) => c.id === head.customerId);
  // Items of the last bill that can still be sold (product active and on this screen's list).
  const repeatable = (lastBill?.items ?? []).filter((i) => prod(i.productId));
  async function repeatLast() {
    const filled = items.filter((l) => l.productId);
    if (filled.length && !(await confirm({ title: 'Replace the items on this bill?', body: <p>The {filled.length} item{filled.length === 1 ? '' : 's'} already added are replaced with the {repeatable.length} from {lastBill?.billNo}.</p>, confirmLabel: 'Replace', cancelLabel: 'Keep mine' }))) return;
    setItems([...repeatable.map((i) => ({ ...blank(), productId: i.productId, unitName: i.unitName, qty: i.qty })), blank()]);
    toast.info(`${repeatable.length} item${repeatable.length === 1 ? '' : 's'} from ${lastBill?.billNo} added — check quantities`);
  }
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
      const run = fromSnap
        ? previewOffline(snap, body, user?.permissions ?? [])
        : api<Preview>('/sales/preview', { method: 'POST', json: body });
      run
        .then((p) => { setPreview(p); setPreviewError(''); })
        .catch((e) => { setPreview(null); setPreviewError(isNetworkError(e) && !snap ? 'No connection, and this PC has no saved data yet.' : e.message); });
    }, fromSnap ? 120 : 400);
    return () => clearTimeout(t);
  }, [body, hasLines, head.locationId, fromSnap, snap, user]);

  const setLine = (set: typeof setItems, list: Line[], i: number, patch: Partial<Line>) => set(list.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (id: string): Partial<Line> => ({ productId: id, unitName: prod(id)?.units[0]?.unitName ?? '', rate: '' });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const offlineSave = async () => {
      const s = snap ?? (await getSnapshot());
      if (!s || !preview) throw new Error('No connection, and this PC has no saved data to bill from yet.');
      const p = fromSnap ? preview : await previewOffline(s, body, user?.permissions ?? []);
      const op = await saveSaleOffline(s, { ...body, overrideCredit: override || undefined }, p, clientId, salesmen.find((x) => x.id === head.salesmanId)?.name ?? null);
      setClientId(crypto.randomUUID());
      setSaved({ id: null, billNo: op.number, net: p.net, offline: op });
      rememberBillDefaults(user?.id, head.saleType, head.locationId, head.salesmanId);
      toast.info(`Bill ${op.number} saved on this PC — it syncs when the connection is back`);
    };
    try {
      if (fromSnap) {
        await offlineSave();
      } else {
        const bill = await api<Saved>('/sales', { method: 'POST', json: { ...body, clientId, overrideCredit: override || undefined } });
        setClientId(crypto.randomUUID());
        setSaved({ id: bill.id, billNo: bill.billNo, net: bill.net ?? preview?.net ?? '0' });
        rememberBillDefaults(user?.id, head.saleType, head.locationId, head.salesmanId);
        toast.success(`Bill ${bill.billNo ?? ''} saved`);
      }
    } catch (err) {
      // The connection dropped while saving: keep the bill on this PC (same clientId, so it can never double up).
      if (!fromSnap && isNetworkError(err)) {
        try { await offlineSave(); } catch (e2) { toast.error((e2 as Error).message); }
      } else {
        toast.error((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  /** Start the next bill: keep where we sell from and the salesman, clear the rest. */
  function newBill() {
    setSaved(null);
    setItems([blank()]);
    setReturns([]);
    setCollected([]);
    setOverride(false);
    setPreview(null);
    setLastBill(null);
    setHead({ ...head, customerId: '', paidNow: '', method: 'CASH', note: '' });
    setFocusTarget('[data-field="customer"] input[role="combobox"]');
  }

  const lineSel = (kind: string, i: number, what: 'product' | 'qty') =>
    `[data-line="${kind}-${i}"] ${what === 'product' ? 'input[role="combobox"]' : 'input[aria-label="Quantity"]'}`;

  /** Enter in qty / rate: go to the next line, adding one at the end. */
  const nextLine = (e: React.KeyboardEvent, list: Line[], set: typeof setItems, kind: string, i: number) => {
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    if (i === list.length - 1) set([...list, blank()]);
    setFocusTarget(lineSel(kind, i + 1, 'product'));
  };

  const onFormKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (canSave) formRef.current?.requestSubmit();
    }
  };

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
    const kind = isReturn ? 'returns' : 'items';
    const last = !isReturn && l.productId ? lastBill?.rates[`${l.productId}|${l.unitName}`] : undefined;
    return (
      <div className={`line${isReturn ? ' ret' : ''}`} key={i} data-line={`${kind}-${i}`}>
        <div className="line-product">
          <Combobox
            ariaLabel="Product" placeholder="Type product name…" options={productOpts} value={l.productId} recentKey="product" compact
            onChange={(v) => setLine(set, list, i, pick(v))}
            onPicked={() => setFocusTarget(lineSel(kind, i, 'qty'))}
          />
          {last && <span className="line-hint">Last bill: {money(last)} / {unitLabel(l.unitName)}</span>}
        </div>
        <select aria-label="Unit" value={l.unitName} onChange={(e) => setLine(set, list, i, { unitName: e.target.value, rate: '' })} disabled={!p}>
          {p?.units.map((u) => <option key={u.unitName} value={u.unitName}>{unitLabel(u.unitName)}</option>)}
        </select>
        <input aria-label="Quantity" type="number" step="any" min="0" placeholder="0" inputMode="decimal" value={l.qty} onChange={(e) => setLine(set, list, i, { qty: e.target.value })} onKeyDown={(e) => nextLine(e, list, set, kind, i)} />
        <input
          aria-label="Rate" type="number" step="any" min="0" disabled={!can(user, 'RATE_EDIT')} value={l.rate}
          placeholder={pr?.rate ? String(Number(pr.rate)) : 'rate'} onChange={(e) => setLine(set, list, i, { rate: e.target.value })}
          onKeyDown={(e) => nextLine(e, list, set, kind, i)}
        />
        {isReturn && (
          <select aria-label="Reason" value={l.reason} onChange={(e) => setLine(set, list, i, { reason: e.target.value })}>
            {RETURN_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}
        <div className={`line-amt${isReturn ? ' neg' : ''}`}>{pr ? `${isReturn ? '-' : ''}${money(pr.amount)}` : '—'}</div>
        <button type="button" className="icon-btn" aria-label="Remove line" onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="x" /></button>
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
          <Link className="back" href="/sales"><Icon name="chevronLeft" />Sales</Link>
          <h1>New bill</h1>
        </div>
        <p className="kbd-help"><kbd>Enter</kbd> next line · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> save</p>
      </div>
      {(error || lookupError) && <p className="error">{error || lookupError}</p>}

      {saved && (
        <div className="modal-scrim">
          <div className="modal success" role="dialog" aria-modal="true" aria-labelledby="saved-title">
            <div className="modal-head">
              <span className={`modal-icon ${saved.offline ? 'info' : 'ok'}`}><Icon name={saved.offline ? 'cloud' : 'check'} /></span>
              <h2 id="saved-title">Bill {saved.billNo} {saved.offline ? 'saved on this PC' : 'saved'}</h2>
            </div>
            <p className="modal-body">
              Total <b>Rs {money(saved.net)}</b>.{' '}
              {saved.offline ? 'There is no connection, so it waits in the outbox and syncs by itself. You can print it now.' : 'Print it now or start the next bill.'}
            </p>
            <div className="success-actions">
              {saved.offline ? (
                <>
                  <button type="button" className="btn primary" onClick={() => setPrinting('thermal')}><Icon name="print" />Print thermal</button>
                  <button type="button" className="btn" onClick={() => setPrinting('a4')}><Icon name="file" />A4 / PDF</button>
                  <Link className="btn" href="/outbox">Open outbox</Link>
                </>
              ) : (
                <>
                  <Link className="btn primary" href={`/sales/${saved.id}?print=thermal`}><Icon name="print" />Print thermal</Link>
                  <Link className="btn" href={`/sales/${saved.id}?print=a4`}><Icon name="file" />A4 / PDF</Link>
                  <Link className="btn" href={`/sales/${saved.id}`}>View bill</Link>
                </>
              )}
              <button type="button" autoFocus onClick={newBill}><Icon name="plus" />New bill</button>
            </div>
          </div>
        </div>
      )}

      {printing && saved?.offline?.bill && <DocPrintDialog bill={saved.offline.bill} autoPrint={printing} onClose={() => setPrinting(null)} />}

      {offline && (
        <div className="offline-note" role="status">
          <Icon name="wifiOff" />
          <span>
            {snap
              ? <>Working offline from data saved {new Date(snap.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}. Bills get numbers like <b>BTL-{sync.prefix ?? 'D?'}-000001</b>, print normally and sync when the connection is back. Balances and stock include bills still waiting to sync.</>
              : <>No connection, and this PC has no saved data yet. Open the app once while online to prepare it for offline billing.</>}
            {snap && !sync.prefix && <> <b>This PC has no device number yet</b> — connect once to set it up.</>}
          </span>
        </div>
      )}

      <form onSubmit={save} className="pos" ref={formRef} onKeyDown={onFormKey}>
        <div className="pos-main">
          <section className="card">
            <div className="step"><span className="step-no">1</span><h2>Sale details</h2></div>
            <div className="seg" role="tablist">
              {[['COUNTER', 'Counter sale'], ['DELIVERY', 'Delivery (vehicle)']].map(([v, l]) => (
                <button type="button" key={v} className={head.saleType === v ? 'on' : ''} onClick={() => {
                  const d = readBillDefaults(user?.id)[v as 'COUNTER' | 'DELIVERY'];
                  setHead({ ...head, saleType: v, locationId: d?.locationId && locations.some((l) => l.id === d.locationId) ? d.locationId : '', salesmanId: head.salesmanId || d?.salesmanId || '' });
                }}>{l}</button>
              ))}
            </div>
            <div className="form">
              <label>{delivery ? 'Vehicle' : 'Sold from'}
                <select required value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}>
                  <option value="">Select…</option>
                  {places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <div className="field" data-field="customer">
                <label htmlFor="bill-customer">Customer</label>
                <Combobox
                  id="bill-customer" options={customerOpts} value={head.customerId} recentKey="customer" required={delivery}
                  emptyLabel={delivery ? undefined : 'Walk-in (cash)'} placeholder={delivery ? 'Search name, shop, phone…' : 'Walk-in (cash) — or search…'}
                  onChange={(v) => { setHead({ ...head, customerId: v }); if (!v) setLastBill(null); }}
                  onPicked={() => setFocusTarget(lineSel('items', 0, 'product'))}
                />
              </div>
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
                {lastBill && (
                  <span className="last-bill">
                    Last bill <Link href={`/sales/${lastBill.id}`}>{lastBill.billNo}</Link> · {new Date(lastBill.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · Rs {money(lastBill.net)}
                    {repeatable.length > 0 && (
                      <button type="button" className="chip repeat-chip" onClick={repeatLast} title="Fill the items of the last bill; rates are today's">
                        <Icon name="refresh" />Repeat ({repeatable.length} item{repeatable.length === 1 ? '' : 's'})
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}
          </section>

          <section className="card">
            <div className="step"><span className="step-no">2</span><h2>Items</h2></div>
            <div className="line head"><span>Product</span><span>Unit</span><span>Qty</span><span>Rate</span><span className="r">Amount</span><span /></div>
            {items.map((l, i) => lineRow(l, i, items, setItems, false, itemPrices))}
            <button type="button" className="add-line" onClick={() => { setItems([...items, blank()]); setFocusTarget(lineSel('items', items.length, 'product')); }}><Icon name="plus" />Add another item</button>
          </section>

          <section className="card">
            <div className="step"><span className="step-no alt">+</span><h2>Returns <small>damaged / expired</small></h2></div>
            {returns.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Customer returning damaged or expired stock? It is credited to their khata and moved to damaged stock.</p>
            ) : (
              <div className="line head ret"><span>Product</span><span>Unit</span><span>Qty</span><span>Rate</span><span>Reason</span><span className="r">Credit</span><span /></div>
            )}
            {returns.map((l, i) => lineRow(l, i, returns, setReturns, true, returnPrices))}
            <button type="button" className="add-line" onClick={() => { setReturns([...returns, blank()]); setFocusTarget(lineSel('returns', returns.length, 'product')); }}><Icon name="plus" />Add a return</button>
          </section>

          {customer && returnable.length > 0 && (
            <section className="card">
              <div className="step"><span className="step-no alt">+</span><h2>Empties collected</h2></div>
              {collected.map((c, i) => (
                <div className="line emp" key={i}>
                  <Combobox
                    ariaLabel="Product" placeholder="Returnable product…" options={productOptions(returnable)} value={c.productId} compact
                    onChange={(v) => setCollected(collected.map((x, j) => (j === i ? { ...x, productId: v } : x)))}
                  />
                  <input aria-label="Empty bottles" type="number" min="1" step="1" placeholder="Empty bottles" value={c.qty} onChange={(e) => setCollected(collected.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                  <button type="button" className="icon-btn" aria-label="Remove" onClick={() => setCollected(collected.filter((_, j) => j !== i))}><Icon name="x" /></button>
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
            <BusyButton className="save-btn" busy={busy} disabled={!canSave} title="Ctrl+Enter">{busy ? 'Saving…' : preview ? `Save bill · Rs ${money(preview.net)}` : 'Save bill'}</BusyButton>
          </div>
        </aside>
      </form>
    </>
  );
}
