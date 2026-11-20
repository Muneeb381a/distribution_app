'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { BusyButton, Empty, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { StatTiles } from '@/components/StatTiles';
import { api, can, useUser } from '@/lib/api';
import { formatQty, formatDate, rupees } from '@dist/shared';
import { usePageTitle } from '@/lib/pageTitle';

interface Unit { unitName: string; factorToBase: string }
interface Row {
  productId: string; name: string; size: string | null; brand: string | null; line: 'BOTTLES' | 'RICE' | null; group: string; category: string;
  baseUnit: 'BOTTLE' | 'KG'; isPacked: boolean; units: Unit[]; recorded: string; onHand: string; cost: string | null;
}
interface Sheet { location: { id: string; name: string; type: string }; rows: Row[] }
interface Place { id: string; name: string; type: 'GODOWN' | 'SHOP' | 'VEHICLE'; isActive: boolean }
interface Entry { big: string; small: string; cost: string }
interface Batch {
  id: string; openingNo: string; location: { id: string; name: string }; asOf: string; note: string | null; totalValue: string; status: 'ACTIVE' | 'CANCELLED';
  createdAt: string; lineCount: number; by: string | null; canReverse: boolean;
}
interface BatchDetail extends Omit<Batch, 'lineCount' | 'by' | 'canReverse'> {
  lines: { id: string; qtyBase: string; openingAfter: string; unitCostBase: string | null; costChanged: boolean; product: { name: string; size: string | null; baseUnit: string; units: Unit[] } }[];
}

type View = 'all' | 'todo' | 'counted' | 'nocost';
type Tab = 'count' | 'history';

/** The bigger unit staff count in: a peti for drinks, a bag (bori) for rice. */
function bigOf(r: Row): { unitName: string; factor: number; label: string } | null {
  const carton = r.units.find((u) => u.unitName === 'CARTON');
  if (carton && Number(carton.factorToBase) > 1) return { unitName: 'CARTON', factor: Number(carton.factorToBase), label: 'Peti' };
  const bag = r.units.find((u) => u.unitName === 'BAG');
  if (bag && Number(bag.factorToBase) > 1) return { unitName: 'BAG', factor: Number(bag.factorToBase), label: r.isPacked ? 'Bags' : 'Bori (bag)' };
  const maund = r.units.find((u) => u.unitName === 'MAUND');
  if (maund && Number(maund.factorToBase) > 1) return { unitName: 'MAUND', factor: Number(maund.factorToBase), label: 'Maund (40 kg)' };
  return null;
}

const num = (s: string | undefined) => (s && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : null);
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Peti and loose bottles (or bags and kg) from a quantity in base units. */
function split(r: Row, base: number): { big: string; small: string } {
  const b = bigOf(r);
  if (!b) return { big: '', small: base ? String(base) : '' };
  const big = Math.trunc(base / b.factor);
  const small = round(base - big * b.factor, 3);
  return { big: big ? String(big) : '', small: small ? String(small) : '' };
}

/** What a row says in base units: its peti times the pack, plus the loose ones. */
function baseOf(r: Row, e: Entry | undefined): number | null {
  if (!e) return null;
  const big = num(e.big);
  const small = num(e.small);
  if (big == null && small == null) return null;
  const b = bigOf(r);
  return round((big ?? 0) * (b?.factor ?? 1) + (small ?? 0), 3);
}

/** The cost per base unit the row would set, or null when none is typed. */
function costBase(r: Row, e: Entry | undefined): number | null {
  const c = num(e?.cost);
  if (c == null || c <= 0) return null;
  return round(c / (bigOf(r)?.factor ?? 1));
}

const smallLabel = (r: Row) => (r.baseUnit === 'BOTTLE' ? 'Bottles' : 'Kg');

/**
 * Stock the shop already had before it started using the software. Count a godown or shop, type the peti and loose
 * bottles (or bags and kg) and the cost, and save. No supplier is involved. Counting again changes only the difference.
 */
export default function OpeningStockPage() {
  usePageTitle('Opening stock');
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const allowed = can(user, 'STOCK_ADJUST');
  const [tab, setTab] = useState<Tab>('count');
  const [places, setPlaces] = useState<Place[]>([]);
  const [placeId, setPlaceId] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [line, setLine] = useState<'all' | 'BOTTLES' | 'RICE'>('all');
  const [view, setView] = useState<View>('all');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [detail, setDetail] = useState<BatchDetail | null>(null);

  useEffect(() => {
    api<Place[]>('/locations').then((l) => {
      const ok = l.filter((x) => x.isActive && x.type !== 'VEHICLE');
      setPlaces(ok);
      setPlaceId((cur) => cur || ok.find((x) => x.type === 'GODOWN')?.id || ok[0]?.id || '');
    }).catch((e) => setError(e.message));
  }, []);

  /** Loads a place and fills the boxes with what is already recorded, so counting again starts from there. */
  const loadSheet = useCallback((id: string) => {
    if (!id) return;
    api<Sheet>(`/stock/opening/sheet?locationId=${id}`).then((s) => {
      setSheet(s);
      const next: Record<string, Entry> = {};
      for (const r of s.rows) {
        const rec = Number(r.recorded);
        const have = rec ? split(r, rec) : { big: '', small: '' };
        const b = bigOf(r);
        next[r.productId] = { ...have, cost: r.cost ? String(round(Number(r.cost) * (b?.factor ?? 1), 2)) : '' };
      }
      setEntries(next);
      setError('');
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { loadSheet(placeId); }, [placeId, loadSheet]);
  const loadBatches = useCallback(() => api<Batch[]>('/stock/openings').then(setBatches).catch((e) => setError(e.message)), []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  const set = (id: string, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [id]: { ...(e[id] ?? { big: '', small: '', cost: '' }), ...patch } }));

  /** Enter moves to the next box, so a long list can be typed without the mouse. */
  const next = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const all = [...document.querySelectorAll<HTMLInputElement>('input.open-in')];
    all[all.indexOf(e.currentTarget) + 1]?.focus();
  };

  const rows = useMemo(() => sheet?.rows ?? [], [sheet]);
  const status = useMemo(() => {
    const m = new Map<string, { qty: number | null; recorded: number; changed: boolean; costChanged: boolean; counted: boolean }>();
    for (const r of rows) {
      const e = entries[r.productId];
      const qty = baseOf(r, e);
      const recorded = Number(r.recorded);
      const cb = costBase(r, e);
      const costChanged = cb != null && (r.cost == null || Math.abs(Number(r.cost) - cb) > 0.00005);
      m.set(r.productId, { qty, recorded, changed: qty != null && (qty !== recorded || costChanged), costChanged, counted: qty != null });
    }
    return m;
  }, [rows, entries]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((r) => {
    const st = status.get(r.productId)!;
    if (line !== 'all' && r.line !== line) return false;
    if (view === 'todo' && st.counted) return false;
    if (view === 'counted' && !st.counted) return false;
    if (view === 'nocost' && !(r.cost == null && (st.counted || Number(r.onHand) > 0))) return false;
    return !q || `${r.name} ${r.size ?? ''} ${r.brand ?? ''} ${r.group} ${r.category}`.toLowerCase().includes(q);
  }), [rows, status, line, view, q]);

  const sections = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of shown) {
      const key = r.category && r.category !== r.group ? `${r.group} · ${r.category}` : r.group || 'Other';
      m.set(key, [...(m.get(key) ?? []), r]);
    }
    return [...m.entries()];
  }, [shown]);

  const changed = rows.filter((r) => status.get(r.productId)!.changed);
  const countedN = rows.filter((r) => status.get(r.productId)!.counted).length;
  const missingCost = changed.filter((r) => costBase(r, entries[r.productId]) == null && r.cost == null);
  const value = (r: Row) => {
    const st = status.get(r.productId)!;
    const cb = costBase(r, entries[r.productId]) ?? (r.cost ? Number(r.cost) : 0);
    return ((st.qty ?? 0) - st.recorded) * cb;
  };
  const totalValue = changed.reduce((s, r) => s + value(r), 0);

  async function save() {
    setBusy(true);
    try {
      const b = await api<{ openingNo: string; lines: unknown[]; totalValue: string }>('/stock/opening', {
        method: 'POST',
        json: {
          locationId: placeId, asOf, note: note.trim() || undefined,
          lines: changed.map((r) => ({ productId: r.productId, qtyBase: status.get(r.productId)!.qty, unitCostBase: costBase(r, entries[r.productId]) ?? undefined })),
        },
      });
      toast.success(`${b.openingNo} saved: ${b.lines.length} product${b.lines.length === 1 ? '' : 's'}, Rs ${rupees(b.totalValue)}`);
      setReview(false);
      setNote('');
      loadSheet(placeId);
      void loadBatches();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reverse(b: Batch) {
    if (!(await confirm({
      title: `Undo ${b.openingNo}?`,
      body: <p>The quantities saved in {b.openingNo} come back off {b.location.name}, and the costs it set go back to what they were. This only works if that stock has not been sold or moved.</p>,
      confirmLabel: 'Undo this save', danger: true,
    }))) return;
    try {
      await api(`/stock/openings/${b.id}/reverse`, { method: 'POST', json: {} });
      toast.success(`${b.openingNo} undone`);
      void loadBatches();
      loadSheet(placeId);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function open(b: Batch) {
    try { setDetail(await api<BatchDetail>(`/stock/openings/${b.id}`)); } catch (e) { toast.error((e as Error).message); }
  }

  if (!allowed) return <p className="error">You need permission to adjust stock to enter opening stock.</p>;

  const place = places.find((p) => p.id === placeId);

  return (
    <>
      <Link className="back" href="/stock"><Icon name="chevronLeft" />Stock</Link>
      <div className="page-head">
        <div>
          <h1>Opening stock</h1>
          <p>The stock the shop already has. Count one place at a time. Nothing is owed to any supplier.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'count'} onClick={() => setTab('count')}>Count stock</button>
        <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>Saved counts{batches?.length ? <span className="count-pill" style={{ marginLeft: 8 }}>{batches.length}</span> : null}</button>
      </div>

      {tab === 'count' && (
        <>
          <section className="card open-intro">
            <div className="open-places" role="radiogroup" aria-label="Place">
              {places.map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={placeId === p.id} className={`open-place${placeId === p.id ? ' on' : ''}`}
                  onClick={async () => {
                    if (p.id === placeId) return;
                    if (changed.length && !(await confirm({ title: 'Switch place?', body: <p>You have typed counts for {place?.name} that are not saved. They will be lost.</p>, confirmLabel: 'Switch and lose them', cancelLabel: 'Keep counting', danger: true }))) return;
                    setSheet(null);
                    setPlaceId(p.id);
                  }}>
                  <Icon name={p.type === 'GODOWN' ? 'stock' : 'locations'} /><span><b>{p.name}</b><small>{p.type === 'GODOWN' ? 'Godown' : 'Shop'}</small></span>
                </button>
              ))}
            </div>
            <ol className="open-steps">
              <li><b>Count</b> what is in {place?.name ?? 'this place'}: peti and loose bottles, or bags and kg.</li>
              <li><b>Cost</b> is what one peti (or bag) cost you. It sets the profit on this stock.</li>
              <li><b>Save.</b> You can count again later; only the difference is added.</li>
            </ol>
          </section>

          <StatTiles items={[
            { label: 'Counted here', value: `${countedN} of ${rows.length}`, sub: place?.name, icon: 'check', tone: countedN ? 'green' : undefined },
            { label: 'To save', value: changed.length, sub: changed.length ? 'products changed' : 'nothing changed yet', icon: 'edit', tone: changed.length ? 'amber' : undefined },
            { label: 'Value of this save', value: <><small>Rs</small>{rupees(totalValue)}</>, sub: 'at the costs typed', icon: 'wallet' },
            { label: 'Without a cost', value: missingCost.length, sub: missingCost.length ? 'profit unknown until set' : 'all have a cost', icon: 'alert', tone: missingCost.length ? 'red' : 'green' },
          ]} />

          <div className="list-head">
            <div className="filter"><Icon name="search" /><input aria-label="Search products" placeholder="Search product, brand or size…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="chips" role="group" aria-label="Kind">
              {([['all', 'Everything'], ['BOTTLES', 'Drinks'], ['RICE', 'Rice']] as const).map(([v, l]) => (
                <button key={v} type="button" className={`chip${line === v ? ' on' : ''}`} aria-pressed={line === v} onClick={() => setLine(v)}>{l}</button>
              ))}
            </div>
            <div className="chips" role="group" aria-label="Show">
              {([['all', 'All'], ['todo', 'Not counted'], ['counted', 'Counted'], ['nocost', 'No cost']] as [View, string][]).map(([v, l]) => (
                <button key={v} type="button" className={`chip${view === v ? ' on' : ''}`} aria-pressed={view === v} onClick={() => setView(v)}>{l}</button>
              ))}
            </div>
          </div>

          {!sheet && !error && <div className="skeleton" style={{ height: 240 }} />}
          {sheet && !rows.length && (
            <Empty icon="products" title="There are no products yet" text="Add the products you sell first, then come back to enter how much of each you have."
              action={<Link className="button" href="/products/catalog"><Icon name="plus" />Add from catalog</Link>} />
          )}

          {sections.map(([title, list]) => (
            <section key={title} className="open-section">
              <h2>{title}<span className="count-pill">{list.length}</span></h2>
              <div className="table-wrap">
                <table className="open-table">
                  <thead>
                    <tr><th>Product</th><th className="num">Peti / bags</th><th className="num">Loose</th><th className="num">Cost</th><th className="num">Total</th><th className="num">Value</th></tr>
                  </thead>
                  <tbody>
                    {list.map((r) => {
                      const e = entries[r.productId] ?? { big: '', small: '', cost: '' };
                      const st = status.get(r.productId)!;
                      const b = bigOf(r);
                      const cb = costBase(r, e) ?? (r.cost ? Number(r.cost) : null);
                      return (
                        <tr key={r.productId} className={st.changed ? 'open-changed' : st.counted ? 'open-done' : ''}>
                          <td>
                            <b>{r.name}</b>{r.size ? <span className="muted"> · {r.size}</span> : null}
                            <div className="open-sub">
                              {st.recorded > 0 && <span className="badge blue" title="Already saved as opening stock here">Saved {formatQty(st.recorded, r.units, r.baseUnit)}</span>}
                              {Number(r.onHand) !== st.recorded && <span className="muted">in stock now {formatQty(r.onHand, r.units, r.baseUnit)}</span>}
                              {r.cost == null && (st.counted || Number(r.onHand) > 0) && <span className="badge amber">No cost yet</span>}
                            </div>
                          </td>
                          <td className="num">{b ? <input className="open-in" type="number" min={0} step="1" inputMode="numeric" aria-label={`${b.label} of ${r.name} ${r.size ?? ''}`} placeholder="0" value={e.big} onChange={(ev) => set(r.productId, { big: ev.target.value })} onKeyDown={next} /> : <span className="muted">—</span>}</td>
                          <td className="num"><input className="open-in" type="number" min={0} step={r.baseUnit === 'KG' ? 'any' : '1'} inputMode="decimal" aria-label={`${smallLabel(r)} of ${r.name} ${r.size ?? ''}`} placeholder="0" value={e.small} onChange={(ev) => set(r.productId, { small: ev.target.value })} onKeyDown={next} /></td>
                          <td className="num"><span className="open-cost"><small>Rs</small><input className="open-in" type="number" min={0} step="any" inputMode="decimal" aria-label={`Cost of ${r.name} ${r.size ?? ''}`} placeholder="—" value={e.cost} onChange={(ev) => set(r.productId, { cost: ev.target.value })} onKeyDown={next} /><small>/ {b ? (b.unitName === 'CARTON' ? 'peti' : b.unitName === 'MAUND' ? 'maund' : 'bag') : r.baseUnit === 'KG' ? 'kg' : 'bottle'}</small></span></td>
                          <td className="num open-total">{st.qty != null ? formatQty(st.qty, r.units, r.baseUnit) : <span className="muted">—</span>}</td>
                          <td className="num">{st.qty != null && cb != null ? <b>{rupees(st.qty * cb)}</b> : <span className="muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          {sheet && rows.length > 0 && !shown.length && <Empty icon="search" title="Nothing matches" text="Change the search or the filters above." />}

          <div className="catalog-bar" role="region" aria-label="Save">
            <span>{changed.length ? <><b>{changed.length}</b> product{changed.length === 1 ? '' : 's'} to save · <b>Rs {rupees(totalValue)}</b></> : 'Type a count to begin'}</span>
            <div className="actions">
              {changed.length > 0 && <button type="button" className="secondary" onClick={() => loadSheet(placeId)}>Start over</button>}
              <BusyButton busy={false} disabled={!changed.length} onClick={() => setReview(true)}><Icon name="check" />Review &amp; save</BusyButton>
            </div>
          </div>
        </>
      )}

      {tab === 'history' && (
        <>
          <table className="sticky-head">
            <thead><tr><th>Save</th><th>Place</th><th>Counted as of</th><th className="num">Products</th><th className="num">Value</th><th>By</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {batches?.map((b) => (
                <tr key={b.id} className={b.status === 'CANCELLED' ? 'inactive' : ''}>
                  <td><b>{b.openingNo}</b><div className="muted" style={{ fontSize: 12 }}>{formatDate(b.createdAt)}</div></td>
                  <td>{b.location.name}</td>
                  <td>{formatDate(b.asOf)}</td>
                  <td className="num">{b.lineCount}</td>
                  <td className="num"><b>Rs {rupees(b.totalValue)}</b></td>
                  <td className="muted">{b.by}</td>
                  <td>{b.status === 'ACTIVE' ? <span className="badge green">Saved</span> : <span className="badge">Undone</span>}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" className="secondary" onClick={() => void open(b)}>View</button>
                      {b.canReverse && <button type="button" className="secondary danger-hover" onClick={() => void reverse(b)}>Undo</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {batches && !batches.length && <tr><td colSpan={8}><Empty icon="stock" title="Nothing saved yet" text="Counts you save appear here, and the newest one of each place can be undone." /></td></tr>}
            </tbody>
          </table>
        </>
      )}

      {review && (
        <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setReview(false); }}>
          <aside className="drawer wide" role="dialog" aria-modal="true" aria-labelledby="open-review" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setReview(false); }}>
            <header className="drawer-head">
              <span className="drawer-icon"><Icon name="stock" /></span>
              <div><h2 id="open-review">Save the count of {place?.name}</h2><p>{changed.length} product{changed.length === 1 ? '' : 's'} · Rs {rupees(totalValue)} at cost. Check it, then save.</p></div>
              <button type="button" className="drawer-x" onClick={() => setReview(false)} aria-label="Close"><Icon name="x" /></button>
            </header>
            <div className="drawer-body">
              {missingCost.length > 0 && <p className="alert-bar"><Icon name="alert" />{missingCost.length} product{missingCost.length === 1 ? ' has' : 's have'} no cost. They save fine, but the profit on them stays unknown until a cost is set.</p>}
              <div className="table-wrap">
                <table className="review-table">
                  <thead><tr><th>Product</th><th className="num">Was saved</th><th className="num">Now</th><th className="num">Cost</th><th className="num">Value</th></tr></thead>
                  <tbody>
                    {changed.map((r) => {
                      const st = status.get(r.productId)!;
                      const e = entries[r.productId];
                      const b = bigOf(r);
                      return (
                        <tr key={r.productId}>
                          <td><b>{r.name}</b>{r.size ? <span className="muted"> · {r.size}</span> : null}</td>
                          <td className="num muted">{st.recorded ? formatQty(st.recorded, r.units, r.baseUnit) : '—'}</td>
                          <td className="num"><b>{formatQty(st.qty ?? 0, r.units, r.baseUnit)}</b></td>
                          <td className="num">{num(e.cost) ? `Rs ${rupees(Number(e.cost))}` : r.cost ? <span className="muted">Rs {rupees(Number(r.cost) * (b?.factor ?? 1))} (on file)</span> : <span className="badge amber">None</span>}</td>
                          <td className="num">{rupees(value(r))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="open-meta">
                <label>Counted as of<input type="date" max={today} value={asOf} onChange={(e) => setAsOf(e.target.value || today)} /><small className="muted">The day the stock was counted. Today, unless this is stock from before you started.</small></label>
                <label>Note <span className="muted">(optional)</span><input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Counted with Ali on 1 Dec" /></label>
              </div>
            </div>
            <footer className="drawer-foot">
              <span className="drawer-note">No supplier or khata is touched</span>
              <button type="button" className="secondary" disabled={busy} onClick={() => setReview(false)}>Back</button>
              <BusyButton busy={busy} onClick={save}><Icon name="check" />{busy ? 'Saving…' : 'Save count'}</BusyButton>
            </footer>
          </aside>
        </div>
      )}

      {detail && (
        <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <aside className="drawer wide" role="dialog" aria-modal="true" aria-labelledby="open-detail" onKeyDown={(e) => { if (e.key === 'Escape') setDetail(null); }}>
            <header className="drawer-head">
              <span className="drawer-icon"><Icon name="file" /></span>
              <div><h2 id="open-detail">{detail.openingNo}</h2><p>{detail.location.name} · counted as of {formatDate(detail.asOf)}{detail.note ? ` · ${detail.note}` : ''}</p></div>
              <button type="button" className="drawer-x" onClick={() => setDetail(null)} aria-label="Close"><Icon name="x" /></button>
            </header>
            <div className="drawer-body">
              <div className="table-wrap">
                <table className="review-table">
                  <thead><tr><th>Product</th><th className="num">Added</th><th className="num">Total after</th><th className="num">Cost per unit</th></tr></thead>
                  <tbody>
                    {detail.lines.map((l) => (
                      <tr key={l.id}>
                        <td><b>{l.product.name}</b>{l.product.size ? <span className="muted"> · {l.product.size}</span> : null}</td>
                        <td className="num">{Number(l.qtyBase) > 0 ? '+' : ''}{formatQty(l.qtyBase, l.product.units, l.product.baseUnit)}</td>
                        <td className="num">{formatQty(l.openingAfter, l.product.units, l.product.baseUnit)}</td>
                        <td className="num">{l.unitCostBase ? `Rs ${rupees(Number(l.unitCostBase))}` : <span className="muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <footer className="drawer-foot"><span className="drawer-note">{detail.status === 'CANCELLED' ? 'This save was undone' : `Rs ${rupees(detail.totalValue)} at cost`}</span><button type="button" onClick={() => setDetail(null)}>Close</button></footer>
          </aside>
        </div>
      )}
    </>
  );
}
