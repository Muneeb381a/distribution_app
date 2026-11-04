'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Combobox from '@/components/Combobox';
import { Empty, SkeletonRows } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { downloadCsv } from '@/components/Table';
import { api } from '@/lib/api';
import { formatQty, productOptions, useLookups } from '@/lib/lookups';
import { usePageTitle } from '@/lib/pageTitle';
import { formatDate, localDay, presetRange, productLabel } from '@dist/shared';

interface Row {
  id: string; at: string; type: string; status: 'OK' | 'DAMAGED'; qtyBase: string; note: string | null;
  product: { id: string; name: string; size: string | null; baseUnit: string }; location: { id: string; name: string };
  doc: { no: string; party: string; link: string } | null; by: string | null; okAfter?: string; damagedAfter?: string;
}
interface History { rows: Row[]; truncated: boolean; opening?: { ok: string; damaged: string }; closing?: { ok: string; damaged: string } }

/** What each movement is, in words, and which way it usually goes. */
const KIND: Record<string, { label: string; tone: string }> = {
  OPENING: { label: 'Opening stock', tone: 'blue' }, PURCHASE: { label: 'Purchase', tone: 'green' }, PURCHASE_CANCEL: { label: 'Purchase cancelled', tone: '' },
  PURCHASE_RETURN: { label: 'Returned to supplier', tone: 'amber' }, SALE: { label: 'Sale', tone: 'blue' }, SALE_RETURN: { label: 'Customer return', tone: 'amber' },
  SALE_CANCEL: { label: 'Bill cancelled', tone: '' }, TRANSFER_OUT: { label: 'Transfer out', tone: '' }, TRANSFER_IN: { label: 'Transfer in', tone: '' },
  ADJUST: { label: 'Adjustment', tone: 'amber' }, DAMAGE_MARK: { label: 'Marked damaged', tone: 'red' }, DAMAGE_RESTORE: { label: 'Damaged restored', tone: 'green' },
  WRITE_OFF: { label: 'Written off', tone: 'red' },
};
const FILTERS: [string, string][] = [
  ['', 'All'], ['PURCHASE,PURCHASE_CANCEL,PURCHASE_RETURN,OPENING', 'Purchases'], ['SALE,SALE_RETURN,SALE_CANCEL', 'Sales'],
  ['TRANSFER_OUT,TRANSFER_IN', 'Transfers'], ['ADJUST', 'Adjustments'], ['DAMAGE_MARK,DAMAGE_RESTORE,WRITE_OFF', 'Damaged'],
];
type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';
const PRESETS: [Preset, string][] = [['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['lastMonth', 'Last month']];

/**
 * Where stock came from and went. Pick a product for its stock card (stock after every movement),
 * or leave it empty to see the latest movements of everything.
 */
export default function StockHistoryPage() {
  usePageTitle('Stock history');
  const search = useSearchParams();
  const { products, locations } = useLookups();
  const [productId, setProductId] = useState(search.get('product') ?? '');
  const [locationId, setLocationId] = useState(search.get('location') ?? '');
  const [type, setType] = useState('');
  const [preset, setPreset] = useState<Preset>('30d');
  const [[from, to], setRange] = useState<[string, string]>(() => presetRange('30d'));
  const [data, setData] = useState<{ key: string; h: History } | null>(null);
  const [error, setError] = useState('');

  const key = `${productId}|${locationId}|${type}|${from}|${to}`;
  useEffect(() => {
    let stale = false;
    const qs = new URLSearchParams({ from, to, ...(productId ? { productId } : {}), ...(locationId ? { locationId } : {}), ...(type ? { type } : {}) });
    api<History>(`/stock/history?${qs}`)
      .then((h) => { if (!stale) { setData({ key, h }); setError(''); } })
      .catch((e) => { if (!stale) setError(e.message); });
    return () => { stale = true; };
  }, [key, productId, locationId, type, from, to]);

  const h = data?.key === key ? data.h : null;
  const product = products.find((p) => p.id === productId);
  const qty = (v: string | number, p = product) => (p ? formatQty(Math.abs(Number(v)), (p as { units?: { unitName: string; factorToBase: string }[] }).units ?? [], p.baseUnit) : String(Math.abs(Number(v))));
  const unitsOf = (id: string) => products.find((p) => p.id === id);
  const totals = useMemo(() => {
    let inn = 0, out = 0;
    for (const r of h?.rows ?? []) if (r.status === 'OK') { if (Number(r.qtyBase) > 0) inn += Number(r.qtyBase); else out -= Number(r.qtyBase); }
    return { inn, out };
  }, [h]);
  const pick = (p: Preset) => { setPreset(p); setRange(presetRange(p === 'custom' ? '30d' : p)); };

  function exportCsv() {
    if (!h) return;
    downloadCsv(`stock-history-${from}_${to}.csv`, ['Time', 'Product', 'Location', 'Movement', 'Status', 'Qty (base)', 'Document', 'Party', 'By', 'Note', ...(productId ? ['Saleable after', 'Damaged after'] : [])],
      h.rows.map((r) => [r.at, productLabel(r.product), r.location.name, KIND[r.type]?.label ?? r.type, r.status.toLowerCase(), r.qtyBase, r.doc?.no ?? '', r.doc?.party ?? '', r.by ?? '', r.note ?? '', ...(productId ? [r.okAfter ?? '', r.damagedAfter ?? ''] : [])]));
  }

  const card = !!productId;
  const cols = card ? (locationId ? 8 : 9) : 7;

  return (
    <>
      <Link className="back" href="/stock"><Icon name="chevronLeft" />Stock</Link>
      <div className="page-head">
        <div><h1>Stock history</h1><p>{card ? 'Stock card: every movement of this product and the stock after it.' : 'Every purchase, sale, transfer and adjustment. Pick a product for its stock card.'}</p></div>
        <button className="secondary btn-icon" disabled={!h?.rows.length} onClick={exportCsv}><Icon name="download" />Export CSV</button>
      </div>

      <div className="history-filters">
        <div className="history-product">
          <Combobox ariaLabel="Product" options={productOptions(products)} value={productId} placeholder="All products — search to pick one…" onChange={setProductId} recentKey="product" />
          {productId && <button type="button" className="secondary icon-only" aria-label="Clear product" title="All products" onClick={() => setProductId('')}><Icon name="x" /></button>}
        </div>
        <select aria-label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="date-range">
          <input type="date" aria-label="From" value={from} max={to} onChange={(e) => { setPreset('custom'); setRange([e.target.value, to]); }} />
          <span className="muted">to</span>
          <input type="date" aria-label="To" value={to} min={from} max={localDay()} onChange={(e) => { setPreset('custom'); setRange([from, e.target.value]); }} />
        </div>
      </div>
      <div className="filters">
        <div className="chips" role="group" aria-label="Dates">
          {PRESETS.map(([p, l]) => <button key={p} type="button" className={`chip${preset === p ? ' on' : ''}`} aria-pressed={preset === p} onClick={() => pick(p)}>{l}</button>)}
        </div>
        <div className="chips" role="group" aria-label="Movement">
          {FILTERS.map(([v, l]) => <button key={l} type="button" className={`chip${type === v ? ' on' : ''}`} aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>)}
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      {card && h?.opening && h.closing && (
        <div className="stats">
          <div className="stat"><span className="label"><span className="icon"><Icon name="history" /></span>At start</span><span className="value">{qty(h.opening.ok)}</span><span className="sub">{formatDate(from)}{Number(h.opening.damaged) ? ` · ${qty(h.opening.damaged)} damaged` : ''}</span></div>
          <div className="stat"><span className="label"><span className="icon green"><Icon name="plus" /></span>In</span><span className="value">{qty(totals.inn)}</span><span className="sub">purchases, transfers in, returns</span></div>
          <div className="stat"><span className="label"><span className="icon amber"><Icon name="trend" /></span>Out</span><span className="value">{qty(totals.out)}</span><span className="sub">sales, transfers out, damage</span></div>
          <div className="stat"><span className="label"><span className="icon green"><Icon name="stock" /></span>At end</span><span className="value">{qty(h.closing.ok)}</span><span className="sub">{Number(h.closing.damaged) ? `${qty(h.closing.damaged)} damaged` : 'saleable'}{locationId ? '' : ' · all locations'}</span></div>
        </div>
      )}

      <div className="table-wrap">
        <table className="history-table">
          <thead>
            <tr>
              <th>When</th>{!card && <th>Product</th>}{(!locationId || !card) && <th>Location</th>}<th>Movement</th><th>Document</th>
              <th className="num">In</th><th className="num">Out</th>{card && <th className="num">Stock after</th>}<th>By</th>
            </tr>
          </thead>
          <tbody>
            {!h && !error && <SkeletonRows cols={cols} />}
            {card && h?.opening && (
              <tr className="opening"><td>{formatDate(from, 'short')}</td>{!locationId && <td />}<td colSpan={2}>Stock at start</td><td /><td /><td className="num bal">{qty(h.opening.ok)}</td><td /></tr>
            )}
            {h?.rows.map((r) => {
              const n = Number(r.qtyBase);
              const p = unitsOf(r.product.id);
              const k = KIND[r.type] ?? { label: r.type, tone: '' };
              return (
                <tr key={r.id} className={r.status === 'DAMAGED' ? 'damaged-row' : ''}>
                  <td className="nowrap">{formatDate(r.at, 'datetime')}</td>
                  {!card && <td><Link href={`/stock/history?product=${r.product.id}`} onClick={() => setProductId(r.product.id)}>{productLabel(r.product)}</Link></td>}
                  {(!locationId || !card) && <td>{r.location.name}</td>}
                  <td>
                    <span className={`badge ${k.tone}`}>{k.label}</span>
                    {r.status === 'DAMAGED' && <span className="muted" style={{ fontSize: 12 }}> · damaged stock</span>}
                    {r.note && <div className="muted" style={{ fontSize: 12.5 }}>{r.note}</div>}
                  </td>
                  <td>{r.doc ? <><Link href={r.doc.link}>{r.doc.no}</Link><div className="muted" style={{ fontSize: 12.5 }}>{r.doc.party}</div></> : <span className="muted">—</span>}</td>
                  <td className="num amt-credit">{n > 0 ? qty(n, p) : ''}</td>
                  <td className="num amt-debit">{n < 0 ? qty(n, p) : ''}</td>
                  {card && <td className="num bal">{qty(r.okAfter ?? 0, p)}{Number(r.damagedAfter) ? <div className="muted" style={{ fontSize: 12 }}>{qty(r.damagedAfter ?? 0, p)} damaged</div> : null}</td>}
                  <td className="muted">{r.by}</td>
                </tr>
              );
            })}
            {h && !h.rows.length && <tr><td colSpan={cols}><Empty icon="stock" title="No movements in these dates" text="Try a wider date range or another filter." /></td></tr>}
          </tbody>
        </table>
      </div>
      {h?.truncated && <p className="muted" style={{ fontSize: 13 }}>Showing the first 1,000 movements. Narrow the dates or pick a product to see the rest.</p>}
      <p className="muted" style={{ fontSize: 13 }}>Quantities are in bottles (with peti) or kg. Damaged stock is counted separately from saleable stock.</p>
    </>
  );
}
