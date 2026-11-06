'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Combobox from '@/components/Combobox';
import { Choice, Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import MoveLines, { UnitSelect } from '@/components/MoveLines';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';
import { formatQty, productLabel, productOptions, useLookups } from '@/lib/lookups';
import { money } from '@dist/shared';

interface Row {
  productId: string; productName: string; size: string | null; line: string; baseUnit: string;
  units: { unitName: string; factorToBase: string }[]; locationId: string; locationName: string;
  ok: string; damaged: string; latestUnitCost?: string | null; value?: string | null;
}
interface Line { productId: string; unitName: string; qty: string }
interface LowRow { productId: string; name: string; size: string | null; baseUnit: string; units: { unitName: string; factorToBase: string }[]; reorderLevel: string; onHand: string; where: { name: string; qtyBase: string }[] }
const emptyLine: Line = { productId: '', unitName: '', qty: '' };
const KINDS: [string, string, string][] = [
  ['MARK_DAMAGED', 'Mark as damaged', 'Saleable stock found broken or expired'],
  ['WRITE_OFF_DAMAGED', 'Write off damaged', 'Damaged stock thrown away'],
  ['RESTORE_DAMAGED', 'Damaged back to saleable', 'Checked and fine after all (needs approval permission)'],
  ['ADD', 'Add stock (correction)', 'Count found more than the app shows'],
  ['REMOVE', 'Remove stock (correction)', 'Count found less than the app shows'],
];

export default function StockPage() {
  const user = useUser();
  const { products, locations, error: lookupError } = useLookups();
  const [rows, setRows] = useState<Row[] | null>(null);
  const toast = useToast();
  const [filter, setFilter] = useState({ locationId: '', line: '', search: '' });
  const search = useSearchParams();
  const [showLow, setShowLow] = useState(search.get('low') === '1');
  const [low, setLow] = useState<LowRow[] | null>(null);
  useEffect(() => { api<LowRow[]>('/stock/low').then(setLow).catch(() => setLow([])); }, []);
  const [transfer, setTransfer] = useState({ from: '', to: '', lines: [{ ...emptyLine }] });
  const [adjust, setAdjust] = useState({ locationId: '', ...emptyLine, kind: 'MARK_DAMAGED', note: '' });
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'stock' | 'transfer' | 'adjust'>('stock');

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
  const pickProduct = (id: string) => ({ productId: id, unitName: prod(id)?.units[0]?.unitName ?? '' });

  // Unfiltered stock, so the forms can say what is available wherever the list is filtered.
  const [allStock, setAllStock] = useState<Row[]>([]);
  const loadAll = useCallback(() => api<Row[]>('/stock').then(setAllStock).catch(() => {}), []);
  useEffect(() => {
    loadAll();
  }, [loadAll]);
  const onHand = (productId: string, locationId: string) => {
    if (!productId || !locationId) return '—';
    const r = allStock.find((x) => x.productId === productId && x.locationId === locationId);
    return r ? formatQty(r.ok, r.units, r.baseUnit) : '0';
  };

  const [busy, setBusy] = useState<'' | 'transfer' | 'adjust'>('');
  // Bumped after a save so the form remounts clean (no leftover 'invalid' marks on emptied fields).
  const [fresh, setFresh] = useState({ transfer: 0, adjust: 0 });
  async function run(key: 'transfer' | 'adjust', path: string, json: unknown, done: string) {
    setBusy(key);
    try {
      await api(path, { method: 'POST', json });
      toast.success(done);
      await Promise.all([load(), loadAll()]);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy('');
    }
  }

  async function submitTransfer(e: FormEvent) {
    e.preventDefault();
    const ok = await run('transfer', '/stock/transfers', {
      fromLocationId: transfer.from,
      toLocationId: transfer.to,
      items: transfer.lines.map((l) => ({ productId: l.productId, unitName: l.unitName, qty: Number(l.qty) })),
    }, 'Transfer saved');
    if (ok) { setTransfer({ from: transfer.from, to: transfer.to, lines: [{ ...emptyLine }] }); setFresh((f) => ({ ...f, transfer: f.transfer + 1 })); }
  }

  async function submitAdjust(e: FormEvent) {
    e.preventDefault();
    const ok = await run('adjust', '/stock/adjustments', { ...adjust, qty: Number(adjust.qty) }, 'Adjustment saved');
    if (ok) { setAdjust({ ...adjust, qty: '', note: '' }); setFresh((f) => ({ ...f, adjust: f.adjust + 1 })); }
  }

  const showCost = !!rows?.some((r) => 'latestUnitCost' in r);
  const lowIds = useMemo(() => new Set((low ?? []).map((l) => l.productId)), [low]);
  const stats = useMemo(() => ({
    products: new Set(allStock.map((r) => r.productId)).size,
    places: new Set(allStock.filter((r) => Number(r.ok) > 0).map((r) => r.locationId)).size,
    damagedRows: allStock.filter((r) => Number(r.damaged) > 0).length,
    value: allStock.reduce((t, r) => t + Number(r.value ?? 0), 0),
    hasValue: allStock.some((r) => r.value != null),
  }), [allStock]);
  const canMove = can(user, 'STOCK_TRANSFER');
  const canAdjust = can(user, 'STOCK_ADJUST');
  // "Move" / "Adjust" on a row: open that form with the product and place already filled in.
  const startTransfer = (r: Row) => {
    setTransfer({ from: r.locationId, to: transfer.to === r.locationId ? '' : transfer.to, lines: [{ productId: r.productId, unitName: prod(r.productId)?.units[0]?.unitName ?? '', qty: '' }] });
    setFresh((f) => ({ ...f, transfer: f.transfer + 1 }));
    setTab('transfer');
  };
  const startAdjust = (r: Row) => {
    setAdjust({ ...adjust, locationId: r.locationId, ...pickProduct(r.productId), qty: '', note: '' });
    setFresh((f) => ({ ...f, adjust: f.adjust + 1 }));
    setTab('adjust');
  };

  return (
    <>
      <div className="page-head"><div><h1>Stock</h1><p>{rows ? `${rows.length} product / location rows` : 'Loading…'}</p></div>
        <div className="actions"><Link className="btn secondary" href="/stock/history"><Icon name="history" />Stock history</Link></div>
      </div>
      {(error || lookupError) && <p className="error">{error || lookupError}</p>}
      <div className="stats">
        <div className="stat"><span className="label"><span className="icon"><Icon name="products" /></span>Products in stock</span><span className="value">{stats.products}</span><span className="sub">across {stats.places} location{stats.places === 1 ? '' : 's'}</span></div>
        <button type="button" className="stat stat-btn" onClick={() => { setTab('stock'); setShowLow(true); }}>
          <span className="label"><span className={`icon ${low && low.length ? 'amber' : 'green'}`}><Icon name="alert" /></span>Reorder now</span>
          <span className="value">{low ? low.length : '…'}</span><span className="sub">{low && low.length ? 'at or below their reorder level' : 'nothing running low'}</span>
        </button>
        <div className="stat"><span className="label"><span className={`icon ${stats.damagedRows ? 'red' : 'green'}`}><Icon name="ban" /></span>Damaged</span><span className="value">{stats.damagedRows}</span><span className="sub">{stats.damagedRows ? 'product / location rows with damaged stock' : 'no damaged stock'}</span></div>
        {stats.hasValue && <div className="stat"><span className="label"><span className="icon green"><Icon name="wallet" /></span>Stock value</span><span className="value"><small>Rs</small>{money(stats.value)}</span><span className="sub">at latest cost</span></div>}
      </div>
      <div className="tabs" role="tablist" aria-label="Stock views">
        <button type="button" role="tab" aria-selected={tab === 'stock'} onClick={() => setTab('stock')}>Stock levels</button>
        {canMove && <button type="button" role="tab" aria-selected={tab === 'transfer'} onClick={() => setTab('transfer')}>Transfer stock</button>}
        {canAdjust && <button type="button" role="tab" aria-selected={tab === 'adjust'} onClick={() => setTab('adjust')}>Adjust / damaged</button>}
      </div>
      {tab === 'stock' && <>
      <div className="list-head">
        <div className="filter"><Icon name="search" /><input aria-label="Search stock" placeholder="Search product…" value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} /></div>
        <select aria-label="Location" value={filter.locationId} onChange={(e) => setFilter({ ...filter, locationId: e.target.value })}>
          <option value="">All locations</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="chips">
          {[['', 'All'], ['BOTTLES', 'Bottles'], ['RICE', 'Rice']].map(([v, l]) => (
            <button key={v} type="button" className={`chip${filter.line === v ? ' on' : ''}`} aria-pressed={filter.line === v} onClick={() => setFilter({ ...filter, line: v })}>{l}</button>
          ))}
          <button type="button" className={`chip${showLow ? ' on' : ''}`} data-tone="amber" aria-pressed={showLow} onClick={() => setShowLow(!showLow)}>
            Reorder now{low && low.length ? <span className="chip-count">{low.length}</span> : null}
          </button>
        </div>
      </div>
      {showLow && (
        <section className="card alert-card">
          <div className="card-head"><h2><Icon name="alert" /> At or below reorder level</h2><span className="muted" style={{ fontSize: 13 }}>All locations together. Set the level on each product.</span></div>
          {!low ? <span className="skeleton" style={{ display: 'block', height: 80 }} /> : low.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Reorder at</th><th>Where</th></tr></thead>
                <tbody>
                  {low.map((r) => (
                    <tr key={r.productId}>
                      <td><Link href={`/stock/history?product=${r.productId}`}><b>{productLabel(r)}</b></Link></td>
                      <td className={`num${Number(r.onHand) <= 0 ? ' error' : ''}`}><b>{formatQty(r.onHand, r.units, r.baseUnit)}</b></td>
                      <td className="num muted">{formatQty(r.reorderLevel, r.units, r.baseUnit)}</td>
                      <td className="muted">{r.where.map((w) => `${w.name} ${formatQty(w.qtyBase, r.units, r.baseUnit)}`).join(' · ') || 'Out of stock'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing is at its reorder level. Set “Reorder when stock falls to” on a product to watch it.</p>}
        </section>
      )}
      <table className="sticky-head">
        <thead>
          <tr>
            <SortTh k="product" sort={sort} toggle={toggle}>Product</SortTh>
            <SortTh k="location" sort={sort} toggle={toggle}>Location</SortTh>
            <SortTh k="ok" sort={sort} toggle={toggle} num>Saleable</SortTh>
            <SortTh k="damaged" sort={sort} toggle={toggle} num>Damaged</SortTh>
            {showCost && <><th className="num">Cost / base unit</th><SortTh k="value" sort={sort} toggle={toggle} num>Value</SortTh></>}
            <th>Status</th>
            {(canMove || canAdjust) && <th className="no-print"><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {!rows && <SkeletonRows cols={showCost ? 8 : 6} />}
          {page.map((r) => (
            <tr key={`${r.productId}|${r.locationId}`}>
              <td><Link href={`/stock/history?product=${r.productId}&location=${r.locationId}`} title="Stock card"><strong>{productLabel({ name: r.productName, size: r.size })}</strong></Link></td>
              <td><span className="badge">{r.locationName}</span></td>
              <td className="num">{formatQty(r.ok, r.units, r.baseUnit)}</td>
              <td className="num">{Number(r.damaged) ? <span className="badge red">{Number(r.damaged)}</span> : <span className="muted">—</span>}</td>
              {showCost && (
                <>
                  <td className="num">{r.latestUnitCost ? money(r.latestUnitCost) : '—'}</td>
                  <td className="num">{r.value ? <strong>{money(r.value)}</strong> : '—'}</td>
                </>
              )}
              <td>{Number(r.ok) <= 0 ? <span className="badge red">Out</span> : lowIds.has(r.productId) ? <span className="badge amber">Low</span> : <span className="badge green">In stock</span>}</td>
              {(canMove || canAdjust) && (
                <td className="row-actions no-print">
                  {canMove && Number(r.ok) > 0 && <button type="button" className="secondary sm" onClick={() => startTransfer(r)}>Move</button>}
                  {canAdjust && <button type="button" className="secondary sm" onClick={() => startAdjust(r)}>Adjust</button>}
                </td>
              )}
            </tr>
          ))}
          {rows && !rows.length && (
            <tr><td colSpan={showCost ? 8 : 6}><Empty icon="stock" title={filter.search || filter.locationId || filter.line ? 'Nothing matches these filters' : 'No stock yet'} text="Record a purchase or import opening stock." action={<a className="btn primary" href="/purchases">Record a purchase</a>} /></td></tr>
          )}
        </tbody>
      </table>
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />
      </>}

      <div className="stock-forms">
      {canMove && tab === 'transfer' && (
        <FormCard
          key={`t${fresh.transfer}`}
          onSubmit={submitTransfer}
          title="Transfer stock"
          description="Move stock between godowns, the shop and vehicles — e.g. load a van in the morning, unload it at night."
          actions={<FormActions><BusyButton busy={busy === 'transfer'}><Icon name="refresh" />Transfer</BusyButton></FormActions>}
        >
          <FormSection>
            <Field label="From" required span={5}>
              <select required value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })}>
                <option value="">Select location…</option>
                {locations.map((l) => <option key={l.id} value={l.id} disabled={l.id === transfer.to}>{l.name} · {l.type.toLowerCase()}</option>)}
              </select>
            </Field>
            <div className="fld span-2 swap-col">
              <button type="button" className="secondary icon-only" title="Swap" aria-label="Swap from and to" onClick={() => setTransfer({ ...transfer, from: transfer.to, to: transfer.from })}><Icon name="refresh" /></button>
            </div>
            <Field label="To" required span={5}>
              <select required value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })}>
                <option value="">Select location…</option>
                {locations.map((l) => <option key={l.id} value={l.id} disabled={l.id === transfer.from}>{l.name} · {l.type.toLowerCase()}</option>)}
              </select>
            </Field>
            <MoveLines id="transfer" products={products} lines={transfer.lines} onChange={(lines) => setTransfer({ ...transfer, lines })}
              available={(pid) => onHand(pid, transfer.from)}
              note={transfer.from ? `Available is at ${locations.find((x) => x.id === transfer.from)?.name}` : 'Choose “From” to see what is available'} />
          </FormSection>
        </FormCard>
      )}

      {canAdjust && tab === 'adjust' && (
        <FormCard
          key={`a${fresh.adjust}`}
          onSubmit={submitAdjust}
          title="Adjust or damaged stock"
          description="Corrections after a count, and damaged stock. Every change needs a reason and shows in the audit log."
          actions={<FormActions><BusyButton busy={busy === 'adjust'}>Save adjustment</BusyButton></FormActions>}
        >
          <FormSection>
            <Field label="What happened" required span={12}>
              <Choice name="kind" columns={1} value={adjust.kind} onChange={(v) => setAdjust({ ...adjust, kind: v })}
                options={KINDS.filter(([v]) => v !== 'RESTORE_DAMAGED' || can(user, 'DAMAGED_APPROVE')).map(([value, label, description]) => ({ value, label, description }))} />
            </Field>
            <Field label="Location" required span={12}>
              <select required value={adjust.locationId} onChange={(e) => setAdjust({ ...adjust, locationId: e.target.value })}>
                <option value="">Select location…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </Field>
            <Field label="Product" required span={12} htmlFor="adjust-product" hint={adjust.productId && adjust.locationId ? `At this location: ${onHand(adjust.productId, adjust.locationId)}` : undefined}>
              <Combobox id="adjust-product" required compact options={productOpts} value={adjust.productId} recentKey="product" placeholder="Type product name…" onChange={(v) => setAdjust({ ...adjust, ...pickProduct(v) })} />
            </Field>
            <Field label="Unit" required span={6}><UnitSelect product={prod(adjust.productId)} value={adjust.unitName} onChange={(v) => setAdjust({ ...adjust, unitName: v })} /></Field>
            <Field label="Quantity" required span={6}><input type="number" step="any" min="0" required inputMode="decimal" placeholder="0" value={adjust.qty} onChange={(e) => setAdjust({ ...adjust, qty: e.target.value })} /></Field>
            <Field label="Reason" required span={12} hint="At least 3 characters, e.g. “counted 2 short”, “bottles burst in van”.">
              <input required minLength={3} value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} />
            </Field>
          </FormSection>
        </FormCard>
      )}
      </div>
    </>
  );
}
