'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Combobox from '@/components/Combobox';
import { Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';
import { formatQty, productLabel, productOptions, useLookups, type ProductOpt } from '@/lib/lookups';
import { money } from '@dist/shared';

interface Row {
  productId: string; productName: string; size: string | null; line: string; baseUnit: string;
  units: { unitName: string; factorToBase: string }[]; locationId: string; locationName: string;
  ok: string; damaged: string; latestUnitCost?: string | null; value?: string | null;
}
interface Line { productId: string; unitName: string; qty: string }
const emptyLine: Line = { productId: '', unitName: '', qty: '' };
const KINDS = [
  ['ADD', 'Add stock (correction)'],
  ['REMOVE', 'Remove stock (correction)'],
  ['MARK_DAMAGED', 'Mark as damaged'],
  ['RESTORE_DAMAGED', 'Return damaged to saleable (needs approval permission)'],
  ['WRITE_OFF_DAMAGED', 'Write off damaged'],
];

function UnitSelect({ product, value, onChange }: { product?: ProductOpt; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required>
      {product?.units.map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
    </select>
  );
}

export default function StockPage() {
  const user = useUser();
  const { products, locations, error: lookupError } = useLookups();
  const [rows, setRows] = useState<Row[] | null>(null);
  const toast = useToast();
  const [filter, setFilter] = useState({ locationId: '', line: '', search: '' });
  const [transfer, setTransfer] = useState({ from: '', to: '', lines: [{ ...emptyLine }] });
  const [adjust, setAdjust] = useState({ locationId: '', ...emptyLine, kind: 'MARK_DAMAGED', note: '' });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
    return api<Row[]>(`/stock${qs ? `?${qs}` : ''}`).then(setRows).catch((e) => setError(e.message));
  }, [filter]);

  useEffect(() => {
     
    load();
  }, [load]);

  const productOpts = useMemo(() => productOptions(products), [products]);
  type Key = 'product' | 'location' | 'ok' | 'damaged' | 'value';
  const { sorted, sort, toggle } = useSort<Row, Key>(rows ?? [], (r, k) =>
    k === 'product' ? productLabel({ name: r.productName, size: r.size }) : k === 'location' ? r.locationName : k === 'ok' ? r.ok : k === 'damaged' ? r.damaged : r.value);
  const { page, loadMore } = usePaged(sorted, 50);
  const prod = (id: string) => products.find((p) => p.id === id);
  const setLine = (i: number, patch: Partial<Line>) =>
    setTransfer({ ...transfer, lines: transfer.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const pickProduct = (id: string) => ({ productId: id, unitName: prod(id)?.units[0]?.unitName ?? '' });

  async function run(path: string, json: unknown, done: string) {
    try {
      await api(path, { method: 'POST', json });
      toast.success(done);
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  }

  async function submitTransfer(e: FormEvent) {
    e.preventDefault();
    const ok = await run('/stock/transfers', {
      fromLocationId: transfer.from,
      toLocationId: transfer.to,
      items: transfer.lines.map((l) => ({ productId: l.productId, unitName: l.unitName, qty: Number(l.qty) })),
    }, 'Transfer saved');
    if (ok) setTransfer({ from: transfer.from, to: transfer.to, lines: [{ ...emptyLine }] });
  }

  async function submitAdjust(e: FormEvent) {
    e.preventDefault();
    const ok = await run('/stock/adjustments', { ...adjust, qty: Number(adjust.qty) }, 'Adjustment saved');
    if (ok) setAdjust({ ...adjust, qty: '', note: '' });
  }

  const showCost = !!rows?.some((r) => 'latestUnitCost' in r);

  return (
    <>
      <div className="page-head"><div><h1>Stock</h1><p>{rows ? `${rows.length} product / location rows` : 'Loading…'}</p></div></div>
      {(error || lookupError) && <p className="error">{error || lookupError}</p>}
      <div className="card form">
        <label>Location
          <select value={filter.locationId} onChange={(e) => setFilter({ ...filter, locationId: e.target.value })}>
            <option value="">All</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label>Line
          <select value={filter.line} onChange={(e) => setFilter({ ...filter, line: e.target.value })}>
            <option value="">Both</option>
            <option value="BOTTLES">Bottles</option>
            <option value="RICE">Rice</option>
          </select>
        </label>
        <label>Search<input value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} /></label>
      </div>
      <table className="sticky-head">
        <thead>
          <tr>
            <SortTh k="product" sort={sort} toggle={toggle}>Product</SortTh>
            <SortTh k="location" sort={sort} toggle={toggle}>Location</SortTh>
            <SortTh k="ok" sort={sort} toggle={toggle} num>Saleable</SortTh>
            <SortTh k="damaged" sort={sort} toggle={toggle} num>Damaged</SortTh>
            {showCost && <><th className="num">Cost / base unit</th><SortTh k="value" sort={sort} toggle={toggle} num>Value</SortTh></>}
          </tr>
        </thead>
        <tbody>
          {!rows && <SkeletonRows cols={4} />}
          {page.map((r) => (
            <tr key={`${r.productId}|${r.locationId}`}>
              <td><strong>{productLabel({ name: r.productName, size: r.size })}</strong></td>
              <td><span className="badge">{r.locationName}</span></td>
              <td className="num">{formatQty(r.ok, r.units, r.baseUnit)}</td>
              <td className="num">{Number(r.damaged) ? <span className="badge red">{Number(r.damaged)}</span> : <span className="muted">—</span>}</td>
              {showCost && (
                <>
                  <td className="num">{r.latestUnitCost ? money(r.latestUnitCost) : '—'}</td>
                  <td className="num">{r.value ? <strong>{money(r.value)}</strong> : '—'}</td>
                </>
              )}
            </tr>
          ))}
          {rows && !rows.length && (
            <tr><td colSpan={showCost ? 6 : 4}><Empty icon="stock" title={filter.search || filter.locationId || filter.line ? 'Nothing matches these filters' : 'No stock yet'} text="Record a purchase or import opening stock." action={<a className="btn primary" href="/purchases">Record a purchase</a>} /></td></tr>
          )}
        </tbody>
      </table>
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />

      {can(user, 'STOCK_TRANSFER') && (
        <>
          <h2>Transfer stock</h2>
          <form className="card" onSubmit={submitTransfer}>
            <div className="form">
              {(['from', 'to'] as const).map((k) => (
                <label key={k}>{k === 'from' ? 'From' : 'To'}
                  <select required value={transfer[k]} onChange={(e) => setTransfer({ ...transfer, [k]: e.target.value })}>
                    <option value="">—</option>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.type.toLowerCase()})</option>)}
                  </select>
                </label>
              ))}
            </div>
            {transfer.lines.map((l, i) => (
              <div className="form" key={i} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
                <div className="field">
                  <label htmlFor={`transfer-product-${i}`}>Product</label>
                  <Combobox id={`transfer-product-${i}`} required compact options={productOpts} value={l.productId} recentKey="product" placeholder="Type product name…" onChange={(v) => setLine(i, pickProduct(v))} />
                </div>
                <label>Unit<UnitSelect product={prod(l.productId)} value={l.unitName} onChange={(v) => setLine(i, { unitName: v })} /></label>
                <label>Qty<input type="number" step="any" min="0" required value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
                {transfer.lines.length > 1 && (
                  <button type="button" className="secondary" onClick={() => setTransfer({ ...transfer, lines: transfer.lines.filter((_, j) => j !== i) })}>Remove</button>
                )}
              </div>
            ))}
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setTransfer({ ...transfer, lines: [...transfer.lines, { ...emptyLine }] })}>+ Add item</button>
              <button>Transfer</button>
            </div>
          </form>
        </>
      )}

      {can(user, 'STOCK_ADJUST') && (
        <>
          <h2>Adjust / damaged stock</h2>
          <form className="card form" onSubmit={submitAdjust}>
            <label>Location
              <select required value={adjust.locationId} onChange={(e) => setAdjust({ ...adjust, locationId: e.target.value })}>
                <option value="">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <div className="field">
              <label htmlFor="adjust-product">Product</label>
              <Combobox id="adjust-product" required compact options={productOpts} value={adjust.productId} recentKey="product" placeholder="Type product name…" onChange={(v) => setAdjust({ ...adjust, ...pickProduct(v) })} />
            </div>
            <label>Unit<UnitSelect product={prod(adjust.productId)} value={adjust.unitName} onChange={(v) => setAdjust({ ...adjust, unitName: v })} /></label>
            <label>Qty<input type="number" step="any" min="0" required value={adjust.qty} onChange={(e) => setAdjust({ ...adjust, qty: e.target.value })} /></label>
            <label>What
              <select value={adjust.kind} onChange={(e) => setAdjust({ ...adjust, kind: e.target.value })}>
                {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label>Reason (required)<input required minLength={3} value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} /></label>
            <button>Save</button>
          </form>
        </>
      )}
    </>
  );
}
