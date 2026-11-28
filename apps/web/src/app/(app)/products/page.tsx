'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BusyButton, Empty, SkeletonRows, useConfirm, usePrompt, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api, can, useUser } from '@/lib/api';
import Link from 'next/link';
import ChangeRatesDialog from '@/components/ChangeRatesDialog';
import { StatTiles } from '@/components/StatTiles';
import { Affix, Choice, Field, Toggle } from '@/components/Form';
import { DRINK_SIZE_PRESETS, defaultPack, formatQty, money, PRICE_TIERS, round2, unitLabel } from '@dist/shared';

type Line = 'BOTTLES' | 'RICE';
interface Category { id: string; name: string; parentId: string | null; businessLine: { code: Line } }
interface Unit { unitName: string; factorToBase: string }
interface Product {
  id: string; name: string; brand: string | null; size: string | null; returnableEmpty: boolean; isActive: boolean; isPacked: boolean;
  categoryId: string; baseUnit: 'BOTTLE' | 'KG'; reorderLevel: string | null;
  units: Unit[];
  category: { name: string; businessLine: { code: Line } };
}
interface Price { productId: string; unitName: string; tier: string; rate: string }
const rateKey = (unitName: string, tier: string) => `${unitName}|${tier}`;

type RiceMode = 'LOOSE' | 'PACKED';
const EMPTY = { name: '', brand: '', size: '', categoryId: '', packSize: '6', bagKg: '', returnableEmpty: true, reorder: '', riceMode: 'LOOSE' as RiceMode };
const BAG_CHIPS = [5, 10, 20, 25, 40, 50];
type Form = typeof EMPTY;

/** Units sent to the API for a bottle or rice product. */
function unitsFor(line: Line, f: Form) {
  return line === 'BOTTLES'
    ? [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: Number(f.packSize) }]
    : f.riceMode === 'PACKED'
      // Packed rice is sold by the bag; kg is kept as the unit stock is counted in.
      ? [{ unitName: 'KG', factorToBase: 1 }, { unitName: 'BAG', factorToBase: Number(f.bagKg) || 25 }]
      // Loose rice: by kg, by the maund (40 kg) or by the bori (a bag, usually 50 kg).
      : [{ unitName: 'KG', factorToBase: 1 }, { unitName: 'MAUND', factorToBase: 40 }, { unitName: 'BAG', factorToBase: Number(f.bagKg) || 50 }];
}

export default function ProductsPage() {
  const user = useUser();
  const canEdit = can(user, 'MASTER_DATA_EDIT');
  const canRate = can(user, 'RATE_EDIT');
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [line, setLine] = useState<Line>('BOTTLES');
  const [products, setProducts] = useState<Product[] | null>(null);
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  // Saleable stock of each product, all places together.
  const [onHand, setOnHand] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [changingRates, setChangingRates] = useState(false);
  const [cat, setCat] = useState('');
  const [view, setView] = useState<'list' | 'cards'>('list');
  // The view you last used comes back next time (read after mount so the server and browser render the same first).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem('dist.productsView') === 'cards') setView('cards');
  }, []);
  const changeView = (v: 'list' | 'cards') => { setView(v); try { localStorage.setItem('dist.productsView', v); } catch { /* ignore */ } };

  const load = useCallback(async () => {
    try {
      const [p, c, pr, st] = await Promise.all([
        api<Product[]>(`/products?line=${line}&includeInactive=true`),
        api<Category[]>('/categories'),
        api<Price[]>('/product-prices'),
        api<{ productId: string; ok: string }[]>('/stock').catch(() => []),
      ]);
      const held: Record<string, number> = {};
      for (const r of st) held[r.productId] = (held[r.productId] ?? 0) + Number(r.ok);
      setOnHand(held);
      setProducts(p);
      setAllCategories(c);
      setPrices(pr);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [line, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProducts(null);
    load();
  }, [load]);

  // "Basmati › Super Kernel › Sella"
  const paths = useMemo(() => {
    const byId = new Map(allCategories.map((c) => [c.id, c]));
    const walk = (id: string, seen = 0): string => {
      const c = byId.get(id);
      if (!c || seen > 10) return '';
      return c.parentId ? `${walk(c.parentId, seen + 1)} › ${c.name}` : c.name;
    };
    return new Map(allCategories.map((c) => [c.id, walk(c.id)]));
  }, [allCategories]);
  const pathOf = useCallback((id: string) => paths.get(id) ?? '', [paths]);
  /** The categories of one kind of product, as "Basmati › Super Kernel", for the product form. */
  const categoriesFor = useCallback((l: Line) => allCategories.filter((c) => c.businessLine.code === l).map((c) => ({ id: c.id, text: pathOf(c.id) })).sort((a, b) => a.text.localeCompare(b.text)), [allCategories, pathOf]);
  const priceOf = (p: Product) => prices.filter((x) => x.productId === p.id);
  // Loose rice made before bags were offered can only be billed in kg or maund.
  const noBag = useMemo(() => (products ?? []).filter((p) => p.isActive && p.baseUnit === 'KG' && !p.isPacked && !p.units.some((u) => u.unitName === 'BAG')), [products]);
  const [fixingBags, setFixingBags] = useState(false);
  async function addBags() {
    setFixingBags(true);
    try {
      let rated = 0;
      for (let i = 0; i < noBag.length; i += 5) {
        await Promise.all(noBag.slice(i, i + 5).map(async (p) => {
          await api(`/products/${p.id}`, { method: 'PATCH', json: { units: [...p.units.map((u) => ({ unitName: u.unitName, factorToBase: Number(u.factorToBase) })), { unitName: 'BAG', factorToBase: 50 }] } });
          // the bag price follows the kg price, so a bill can use it at once
          const mine = prices.filter((x) => x.productId === p.id);
          const bag = mine.filter((x) => x.unitName === 'KG').map((x) => ({ unitName: 'BAG', tier: x.tier ?? 'RETAIL', rate: round2(Number(x.rate) * 50) }));
          if (canRate && bag.length) {
            await api(`/product-prices/${p.id}`, { method: 'PUT', json: { prices: [...mine.map((x) => ({ unitName: x.unitName, tier: x.tier ?? 'RETAIL', rate: Number(x.rate) })), ...bag] } });
            rated += 1;
          }
        }));
      }
      toast.success(`Bag option (50 kg) added to ${noBag.length} rice product${noBag.length === 1 ? '' : 's'}${rated ? `, with a bag rate worked out from the kg rate` : ''}`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFixingBags(false);
    }
  }

  const inactiveCount = products?.filter((p) => !p.isActive).length ?? 0;
  const topOf = useCallback((p: Product) => pathOf(p.categoryId).split(' › ')[0] || p.category.name, [pathOf]);
  const inScope = useMemo(() => (products ?? []).filter((p) => showInactive || p.isActive), [products, showInactive]);
  const topCategories = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of inScope) m.set(topOf(p), (m.get(topOf(p)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [inScope, topOf]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return inScope.filter((p) => (!cat || topOf(p) === cat) && (!f || `${p.name} ${p.brand ?? ''} ${p.size ?? ''} ${pathOf(p.categoryId)}`.toLowerCase().includes(f)));
  }, [inScope, filter, cat, pathOf, topOf]);
  type Key = 'name' | 'category' | 'size' | 'rate';
  const { sorted, sort, toggle } = useSort<Product, Key>(shown, (p, k) =>
    k === 'name' ? p.name : k === 'category' ? pathOf(p.categoryId) : k === 'size' ? p.size : priceOf(p)[0]?.rate ?? null);
  const { page, loadMore, reset } = usePaged(sorted, 30);
  const missingRate = (products ?? []).filter((p) => p.isActive && !priceOf(p).length).length;
  const activeCount = (products ?? []).filter((p) => p.isActive).length;
  const returnable = (products ?? []).filter((p) => p.isActive && p.returnableEmpty).length;
  const bagged = (products ?? []).filter((p) => p.isActive && p.isPacked).length;

  const rowActions = (p: Product) => (
    <div className="row-actions">
      <button type="button" className="secondary icon-only" title={canEdit ? 'Edit' : 'Edit rates'} aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)}><Icon name="edit" /></button>
      {!canEdit ? null : p.isActive
        ? <button type="button" className="secondary icon-only danger-hover" title="Deactivate" aria-label={`Deactivate ${p.name}`} onClick={() => setActive(p, false)}><Icon name="ban" /></button>
        : <button type="button" className="secondary" onClick={() => setActive(p, true)}>Activate</button>}
    </div>
  );
  const emptyState = () => (filter || cat
    ? <Empty icon="search" title={filter ? `No product matches “${filter}”` : 'No product in this category'} />
    : <Empty icon="products" title={`No ${line === 'BOTTLES' ? 'bottle' : 'rice'} products yet`} text="Add one here or bring a list in with Import." action={canEdit && <button type="button" onClick={() => setEditing('new')}><Icon name="plus" />Add first product</button>} />);

  async function setActive(p: Product, isActive: boolean) {
    if (!isActive && !(await confirm({ title: `Deactivate ${p.name}?`, body: <p>It is hidden from bills, purchases and stock pickers. Stock and history stay; you can activate it again.</p>, confirmLabel: 'Deactivate', danger: true }))) return;
    try {
      await api(`/products/${p.id}`, { method: 'PATCH', json: { isActive } });
      toast.success(`${p.name} ${isActive ? 'activated' : 'deactivated'}`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function addCategory() {
    const name = await prompt({ title: `New ${line === 'BOTTLES' ? 'bottle' : 'rice'} category`, label: 'Name, e.g. "Coca-Cola" or "Basmati"', confirmLabel: 'Add category', minLength: 2 });
    if (!name) return;
    try {
      await api('/categories', { method: 'POST', json: { businessLine: line, name: name.trim() } });
      toast.success(`Category “${name.trim()}” added`);
      load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><p>{products ? `${activeCount} active ${line === 'BOTTLES' ? 'bottle' : 'rice'} product${activeCount === 1 ? '' : 's'}` : 'Loading…'}</p></div>
        {canEdit && (
          <div className="actions">
            <button className="secondary btn-icon" onClick={addCategory}><Icon name="plus" />Category</button>
            <Link className="btn secondary" href="/products/catalog"><Icon name="import" />Add from catalog</Link>
            <button className="btn-icon" onClick={() => setEditing('new')}><Icon name="plus" />Add product</button>
          </div>
        )}
      </div>

      <StatTiles items={[
        { label: 'Products', value: activeCount, sub: inactiveCount ? `${inactiveCount} inactive` : 'all active', icon: 'products' },
        { label: 'Categories', value: topCategories.length, sub: line === 'BOTTLES' ? 'brands and companies' : 'rice varieties', icon: 'stock' },
        { label: 'Without a rate', value: missingRate, sub: missingRate ? 'bills will ask for a rate' : 'every product has a rate', icon: 'alert', tone: missingRate ? 'red' : 'green' },
        line === 'BOTTLES'
          ? { label: 'Returnable empties', value: returnable, sub: 'tracked per customer', icon: 'refresh' as const, tone: 'amber' as const }
          : { label: 'Sold in bags', value: bagged, sub: 'the rest by kg and maund', icon: 'purchases' as const, tone: 'amber' as const },
      ]} />

      <div className="list-head">
        <div className="seg" role="radiogroup" aria-label="Business line" style={{ margin: 0 }}>
          {(['BOTTLES', 'RICE'] as Line[]).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={line === l} className={line === l ? 'on' : ''} onClick={() => { setLine(l); setCat(''); reset(); }}>{l === 'BOTTLES' ? 'Bottles' : 'Rice'}</button>
          ))}
        </div>
        <div className="filter"><Icon name="search" /><input aria-label="Filter products" placeholder="Search name, brand, size, category…" value={filter} onChange={(e) => { setFilter(e.target.value); reset(); }} /></div>
        <div className="list-head-end">
          {inactiveCount > 0 && <button type="button" className={`chip${showInactive ? ' on' : ''}`} aria-pressed={showInactive} onClick={() => setShowInactive(!showInactive)}>Show inactive<span className="chip-count">{inactiveCount}</span></button>}
          {canRate && shown.some((p) => p.isActive) && (
            <button type="button" className="secondary btn-icon" onClick={() => setChangingRates(true)} title="Change the list rates of the products shown">
              <Icon name="trend" />Change rates{filter || cat ? ` (${shown.filter((p) => p.isActive).length})` : ''}
            </button>
          )}
          <div className="view-toggle" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => changeView('list')} title="List"><Icon name="menu" /></button>
            <button type="button" role="radio" aria-checked={view === 'cards'} className={view === 'cards' ? 'on' : ''} onClick={() => changeView('cards')} title="Cards"><Icon name="dashboard" /></button>
          </div>
        </div>
      </div>

      {topCategories.length > 1 && (
        <div className="chips cat-chips" role="group" aria-label="Category">
          <button type="button" className={`chip${!cat ? ' on' : ''}`} aria-pressed={!cat} onClick={() => { setCat(''); reset(); }}>All<span className="chip-count">{inScope.length}</span></button>
          {topCategories.map(([name, count]) => (
            <button key={name} type="button" className={`chip${cat === name ? ' on' : ''}`} aria-pressed={cat === name} onClick={() => { setCat(cat === name ? '' : name); reset(); }}>{name}<span className="chip-count">{count}</span></button>
          ))}
        </div>
      )}

      {line === 'RICE' && canEdit && noBag.length > 0 && (
        <p className="alert-bar" role="status">
          <Icon name="alert" />
          <span><b>{noBag.length} loose rice product{noBag.length === 1 ? ' has' : 's have'} no bag option</b>, so bills, purchases and stock can only use kg and maund. This adds a 50 kg bori to {noBag.length === 1 ? 'it' : 'all of them'} (you can change the weight by editing a product).</span>
          <button type="button" disabled={fixingBags} onClick={() => void addBags()}>{fixingBags ? 'Adding…' : 'Add bag option'}</button>
        </p>
      )}

      {missingRate > 0 && (
        <p className="error" role="status"><Icon name="alert" /> {missingRate} active product{missingRate === 1 ? ' has' : 's have'} no default sale rate. Bills for customers without a fixed rate will ask for one.</p>
      )}

      {view === 'list' ? (
        <table className="sticky-head prod-table">
          <thead>
            <tr>
              <SortTh k="name" sort={sort} toggle={toggle}>Product</SortTh>
              <SortTh k="category" sort={sort} toggle={toggle}>Category</SortTh>
              <th>Packing</th>
              <th className="num">In stock</th>
              <SortTh k="rate" sort={sort} toggle={toggle} num>Default rate</SortTh>
              {(canEdit || canRate) && <th><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {!products && <SkeletonRows cols={canEdit || canRate ? 6 : 5} />}
            {page.map((p) => (
              <tr key={p.id} className={p.isActive ? '' : 'inactive'}>
                <td>
                  <span className="person">
                    <ProductTile line={line} />
                    <span className="person-text">
                      <b>{p.name}{!p.isActive && <> <span className="badge">Inactive</span></>}</b>
                      <span>{[p.brand, p.size].filter(Boolean).join(' · ') || 'No brand or size'}</span>
                    </span>
                  </span>
                </td>
                <td><span className="cat-path">{(pathOf(p.categoryId) || p.category.name).split(' › ').map((part, i) => <span key={i}>{part}</span>)}</span></td>
                <td><Packing p={p} /></td>
                <td className="num"><Held p={p} qty={onHand[p.id]} /></td>
                <td className="num"><Rates rows={priceOf(p)} /></td>
                {(canEdit || canRate) && <td>{rowActions(p)}</td>}
              </tr>
            ))}
            {products && !shown.length && <tr><td colSpan={6}>{emptyState()}</td></tr>}
          </tbody>
        </table>
      ) : (
        <>
          {!products && <div className="prod-cards">{[0, 1, 2].map((i) => <span key={i} className="skeleton" style={{ height: 190 }} />)}</div>}
          <div className="prod-cards">
            {page.map((p) => (
              <article key={p.id} className={`card prod-card${p.isActive ? '' : ' inactive'}`}>
                <header>
                  <ProductTile line={line} size={46} />
                  <span className="prod-card-title">
                    <b>{p.name}</b>
                    <span>{[p.brand, p.size].filter(Boolean).join(' · ') || 'No brand or size'}</span>
                  </span>
                  {(canEdit || canRate) && rowActions(p)}
                </header>
                <span className="cat-path">{(pathOf(p.categoryId) || p.category.name).split(' › ').map((part, i) => <span key={i}>{part}</span>)}{!p.isActive && <span className="badge">Inactive</span>}</span>
                <Packing p={p} />
                <div className="prod-card-rates"><span>In stock</span><Held p={p} qty={onHand[p.id]} /></div>
                <div className="prod-card-rates"><span>Default rate</span><Rates rows={priceOf(p)} left /></div>
              </article>
            ))}
          </div>
          {products && !shown.length && emptyState()}
        </>
      )}
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />

      {changingRates && (
        <ChangeRatesDialog line={line} productIds={shown.filter((p) => p.isActive).map((p) => p.id)} onClose={() => setChangingRates(false)}
          onDone={(n) => { setChangingRates(false); toast.success(`${n} rate${n === 1 ? '' : 's'} changed`); load(); }} />
      )}

      {editing && (
        <ProductDialog
          key={editing === 'new' ? 'new' : editing.id}
          line={line}
          product={editing === 'new' ? null : editing}
          categoriesFor={categoriesFor}
          onNewCategory={async (l, name) => { const c = await api<{ id: string }>('/categories', { method: 'POST', json: { businessLine: l, name } }); await load(); return c; }}
          prices={editing === 'new' ? [] : priceOf(editing)}
          canEdit={canEdit}
          canRate={canRate}
          onClose={() => setEditing(null)}
          onSaved={(name, saved) => { setEditing(null); toast.success(`${name} saved`); if (saved !== line) setLine(saved); else load(); }}
          onError={(m) => toast.error(m)}
        />
      )}
    </>
  );
}

function ProductTile({ line, size = 40 }: { line: Line; size?: number }) {
  return <span className={`prod-tile ${line === 'BOTTLES' ? 'bottles' : 'rice'}`} style={{ width: size, height: size }}><Icon name="products" /></span>;
}

/** How it is packed: units bigger than the base unit, and whether empties come back. */
/** What is in stock, with the bags beside the kg for rice and the peti beside the bottles. */
function Held({ p, qty }: { p: Product; qty: number | undefined }) {
  if (!qty) return <span className="muted">None</span>;
  return <b className="held">{formatQty(qty, p.units, p.baseUnit)}</b>;
}

function Packing({ p }: { p: Product }) {
  const packs = p.units.filter((u) => Number(u.factorToBase) !== 1);
  return (
    <span className="chips" style={{ gap: 5 }}>
      {packs.map((u) => <span key={u.unitName} className="badge blue">1 {unitLabel(u.unitName)} = {Number(u.factorToBase)} {p.baseUnit === 'KG' ? 'kg' : 'bottles'}</span>)}
      {p.returnableEmpty && <span className="badge teal">returnable</span>}
      {!packs.length && !p.returnableEmpty && <span className="muted">—</span>}
    </span>
  );
}

/** Retail rate per unit, with the wholesale rate beside it when there is one. */
function Rates({ rows, left }: { rows: Price[]; left?: boolean }) {
  const retail = rows.filter((x) => (x.tier ?? 'RETAIL') === 'RETAIL');
  if (!retail.length) return <span className="badge amber">Not set</span>;
  return (
    <div className={`rates${left ? ' left' : ''}`}>
      {retail.map((x) => {
        const w = rows.find((y) => y.unitName === x.unitName && y.tier === 'WHOLESALE');
        return (
          <div key={x.unitName}>
            <b>Rs {money(x.rate)}</b><span className="muted"> / {unitLabel(x.unitName)}</span>
            {w && <span className="whole-rate" title="Wholesale rate">W {money(w.rate)}</span>}
          </div>
        );
      })}
    </div>
  );
}

function ProductDialog({ line: startLine, product, categoriesFor, onNewCategory, prices, canEdit, canRate, onClose, onSaved, onError }: {
  line: Line; product: Product | null; categoriesFor: (l: Line) => { id: string; text: string }[]; onNewCategory: (l: Line, name: string) => Promise<{ id: string }>; prices: Price[];
  canEdit: boolean; canRate: boolean; onClose: () => void; onSaved: (name: string, line: Line) => void; onError: (m: string) => void;
}) {
  // A new product is for drinks or for rice, chosen here; an existing one keeps what it is.
  const [line, setLine] = useState<Line>(startLine);
  const [newCat, setNewCat] = useState<string | null>(null);
  const categories = categoriesFor(line);
  const factor = (u: string) => product?.units.find((x) => x.unitName === u)?.factorToBase;
  const [form, setForm] = useState<Form>(() => (product ? {
    name: product.name, brand: product.brand ?? '', size: product.size ?? '', categoryId: product.categoryId,
    packSize: String(Number(factor('CARTON') ?? 6)), bagKg: factor('BAG') ? String(Number(factor('BAG'))) : product.baseUnit === 'KG' ? '50' : '', returnableEmpty: product.returnableEmpty,
    riceMode: (product.isPacked ? 'PACKED' : 'LOOSE') as RiceMode,
    // Shown in peti for bottles, kg for rice; stored in base units.
    reorder: product.reorderLevel == null ? '' : String(round2(Number(product.reorderLevel) / (product.baseUnit === 'BOTTLE' ? Number(factor('CARTON') ?? 1) : 1))),
  } : { ...EMPTY, bagKg: startLine === 'RICE' ? '50' : '', returnableEmpty: startLine === 'BOTTLES' }));
  const units = unitsFor(line, form);
  // Keyed "CARTON|RETAIL", "CARTON|WHOLESALE"…
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(prices.map((p) => [rateKey(p.unitName, p.tier ?? 'RETAIL'), String(Number(p.rate))])));
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  /** Switching between drinks and rice starts the form over: the units, the size and the categories all differ. */
  const switchKind = (k: Line) => {
    if (k === line) return;
    setLine(k);
    setForm({ ...EMPTY, name: form.name, brand: form.brand, returnableEmpty: k === 'BOTTLES', bagKg: k === 'RICE' ? '50' : '' });
    setRates({});
    setNewCat(null);
  };
  async function addCategory() {
    const name = (newCat ?? '').trim();
    if (name.length < 2) return;
    try {
      const c = await onNewCategory(line, name);
      set({ categoryId: c.id });
      setNewCat(null);
    } catch (err) {
      onError((err as Error).message);
    }
  }
  /** Typing or picking a size fills bottles per peti and returnable from the usual pack. */
  const setSize = (size: string) => {
    const d = product ? null : defaultPack(size); // never change an existing product's peti by accident
    set(d ? { size, packSize: String(d.pack), returnableEmpty: d.returnable } : { size });
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const bottles = line === 'BOTTLES';
    const body = {
      categoryId: form.categoryId, name: form.name.trim(), brand: form.brand || undefined, size: (form.size || (!bottles && form.riceMode === 'PACKED' && form.bagKg ? `${Number(form.bagKg)} kg bag` : '')) || undefined,
      isPacked: !bottles && form.riceMode === 'PACKED', returnableEmpty: bottles && form.returnableEmpty, units,
      reorderLevel: form.reorder === '' ? null : Number(form.reorder) * (bottles ? Number(form.packSize) || 1 : 1),
    };
    try {
      // Someone with only the rate permission edits rates, not the product itself.
      const saved = product && !canEdit
        ? product
        : product
        ? await api<{ id: string }>(`/products/${product.id}`, { method: 'PATCH', json: body })
        : await api<{ id: string }>('/products', { method: 'POST', json: { ...body, baseUnit: bottles ? 'BOTTLE' : 'KG' } });
      if (canRate) {
        const list = units.flatMap((u) => PRICE_TIERS.map((t) => ({ unitName: u.unitName, tier: t.value as string, raw: rates[rateKey(u.unitName, t.value)] })))
          .filter((x) => x.raw !== undefined && x.raw !== '').map(({ unitName, tier, raw }) => ({ unitName, tier, rate: Number(raw) }));
        const before = JSON.stringify(prices.map((p) => [p.unitName, p.tier ?? 'RETAIL', Number(p.rate)]).sort());
        if (JSON.stringify(list.map((p) => [p.unitName, p.tier, p.rate]).sort()) !== before) {
          await api(`/product-prices/${saved.id}`, { method: 'PUT', json: { prices: list } });
        }
      }
      onSaved(form.name.trim(), line);
    } catch (err) {
      onError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="product-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <form onSubmit={submit}>
          <div className="modal-head">
            <span className="modal-icon info"><Icon name="products" /></span>
            <h2 id="product-title">{product ? `Edit ${product.name}` : `New ${line === 'BOTTLES' ? 'drink' : 'rice'} product`}</h2>
          </div>
          <fieldset disabled={!canEdit} className="plain-fieldset">
            <div className="fgrid">
              {!product && (
                <div className="fld span-12">
                  <span className="fld-label"><span>What are you adding?</span></span>
                  <div className="kind-switch" role="radiogroup" aria-label="What are you adding?">
                    <button type="button" role="radio" aria-checked={line === 'BOTTLES'} className={`kind-opt${line === 'BOTTLES' ? ' on' : ''}`} onClick={() => switchKind('BOTTLES')}><Icon name="products" /><span><b>Drinks</b><small>Bottles, sold by the peti</small></span></button>
                    <button type="button" role="radio" aria-checked={line === 'RICE'} className={`kind-opt${line === 'RICE' ? ' on' : ''}`} onClick={() => switchKind('RICE')}><Icon name="stock" /><span><b>Rice</b><small>Sold by kg, maund or bag</small></span></button>
                  </div>
                </div>
              )}
              <Field label="Category" required span={12} hint={!categories.length ? `There is no ${line === 'BOTTLES' ? 'drinks' : 'rice'} category yet. Add one below.` : undefined}>
                <select required value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                  <option value="">Select category…</option>
                  {categories.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
                </select>
                {!product && (newCat === null
                  ? <button type="button" className="cat-link" style={{ marginTop: 6 }} onClick={() => setNewCat('')}><Icon name="plus" />New {line === 'BOTTLES' ? 'drinks' : 'rice'} category</button>
                  : (
                    <span className="cat-new">
                      <input autoFocus value={newCat} maxLength={60} placeholder={line === 'BOTTLES' ? 'e.g. Coca-Cola' : 'e.g. Basmati'} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory(); } if (e.key === 'Escape') setNewCat(null); }} />
                      <button type="button" disabled={newCat.trim().length < 2} onClick={() => void addCategory()}>Add</button>
                      <button type="button" className="secondary" onClick={() => setNewCat(null)}>Cancel</button>
                    </span>
                  ))}
              </Field>
              <Field label="Name" required span={6} hint={line === 'BOTTLES' ? 'Brand and flavour, e.g. "Pepsi" or "Shezan Mango"' : 'Variety and form, e.g. "Super Kernel Sella"'}>
                <input required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label={line === 'BOTTLES' ? 'Company' : 'Brand'} optional span={6}>
                <input value={form.brand} placeholder={line === 'BOTTLES' ? 'PepsiCo' : 'Guard, Falak…'} onChange={(e) => set({ brand: e.target.value })} />
              </Field>
              {line === 'BOTTLES' ? (
                <>
                  <Field label="Size" span={12} hint="Pick a common size to fill in bottles per peti, or type your own.">
                    <input value={form.size} placeholder="1.5 L" onChange={(e) => setSize(e.target.value)} />
                  </Field>
                  <div className="span-12 size-chips" role="group" aria-label="Common sizes">
                    {DRINK_SIZE_PRESETS.map((p) => (
                      <button key={p.size} type="button" className={`size-chip${form.size === p.size ? ' on' : ''}`} aria-pressed={form.size === p.size} onClick={() => setSize(p.size)}>
                        <b>{p.size}</b><span>{p.pack}/peti{p.returnable ? ' · ♻' : ''}</span>
                      </button>
                    ))}
                  </div>
                  <Field label="Bottles per peti" required span={6} hint="How many bottles come in one carton/crate">
                    <Affix suffix="bottles"><input type="number" min="1" step="1" required inputMode="numeric" value={form.packSize} onChange={(e) => set({ packSize: e.target.value })} /></Affix>
                  </Field>
                  <div className="fld span-6 toggle-fld">
                    <Toggle checked={form.returnableEmpty} onChange={(v) => set({ returnableEmpty: v })} label="Returnable empty" description="Glass bottles — empties are tracked per customer" />
                  </div>
                </>
              ) : (
                <>
                  <div className="fld span-12">
                    <span className="fld-label"><span>How is it sold?</span></span>
                    <Choice name="rice-mode" value={form.riceMode} columns={2}
                      onChange={(v) => set({ riceMode: v, bagKg: v === 'LOOSE' ? (Number(form.bagKg) > 0 ? form.bagKg : '50') : (form.bagKg === '50' || !form.bagKg ? '25' : form.bagKg) })}
                      options={[
                        { value: 'LOOSE', label: 'Loose rice', description: 'By kg, by maund or by the bori (bag)', icon: 'stock' },
                        { value: 'PACKED', label: 'Packed bags', description: 'Fixed bags like 5, 10 or 25 kg', icon: 'products' },
                      ]} />
                  </div>
                  <Field label={form.riceMode === 'LOOSE' ? 'Bori (bag) weight' : 'Bag weight'} required span={6} hint={form.riceMode === 'LOOSE' ? 'What one bag of this rice weighs, usually 50 kg. A maund is always 40 kg.' : 'What one bag weighs.'}>
                    <Affix suffix="kg"><input type="number" step="any" min="0.1" required inputMode="decimal" value={form.bagKg} onChange={(e) => set({ bagKg: e.target.value })} /></Affix>
                  </Field>
                  <Field label="Size" optional span={6} hint={form.riceMode === 'PACKED' ? 'Leave empty to use the bag weight, e.g. "25 kg bag".' : undefined}>
                    <input value={form.size} placeholder={form.riceMode === 'PACKED' ? `${Number(form.bagKg) || 25} kg bag` : 'Optional'} onChange={(e) => set({ size: e.target.value })} />
                  </Field>
                  {form.riceMode === 'PACKED' && (
                    <div className="span-12 size-chips" role="group" aria-label="Common bag weights">
                      {BAG_CHIPS.map((kg) => (
                        <button key={kg} type="button" className={`size-chip${Number(form.bagKg) === kg ? ' on' : ''}`} aria-pressed={Number(form.bagKg) === kg} onClick={() => set({ bagKg: String(kg) })}><b>{kg} kg</b><span>bag</span></button>
                      ))}
                    </div>
                  )}
                  <p className="span-12 rice-units" aria-live="polite">
                    <span>Bills, purchases and stock can use</span>
                    {units.map((u) => <b key={u.unitName} className="badge blue">{u.unitName === 'KG' ? 'Kg' : u.unitName === 'MAUND' ? 'Maund (40 kg)' : `${form.riceMode === 'LOOSE' ? 'Bori' : 'Bag'} (${Number(u.factorToBase)} kg)`}</b>)}
                  </p>
                </>
              )}
              <Field label="Reorder when stock falls to" optional span={6} hint="All locations together. Shows on the dashboard and Stock page when reached.">
                <Affix suffix={line === 'BOTTLES' ? 'peti' : 'kg'}><input type="number" step="any" min="0" inputMode="decimal" placeholder="Not watched" value={form.reorder} onChange={(e) => set({ reorder: e.target.value })} /></Affix>
              </Field>
            </div>
          </fieldset>
          <h3 style={{ margin: '22px 0 4px' }}>List rates</h3>
          <p className="card-sub" style={{ margin: '0 0 12px' }}>
            Used on bills when the customer has no fixed rate: retail for retail customers and walk-ins, wholesale for wholesale customers.
            An empty wholesale rate uses the retail rate. {canRate ? 'Leave both empty to require a rate on the bill.' : 'You need the rate-edit permission to change these.'}
          </p>
          <div className="rate-grid">
            <span /><span className="rate-head">Retail</span><span className="rate-head">Wholesale</span>
            {units.map((u) => {
              const r = (t: string) => rates[rateKey(u.unitName, t)] ?? '';
              const set = (t: string, v: string) => setRates({ ...rates, [rateKey(u.unitName, t)]: v });
              const retail = Number(r('RETAIL')), whole = Number(r('WHOLESALE'));
              return (
                <Fragment key={u.unitName}>
                  <span className="rate-unit">Per {unitLabel(u.unitName)}</span>
                  <Affix prefix="Rs"><input aria-label={`Retail rate per ${unitLabel(u.unitName)}`} type="number" step="any" min="0" inputMode="decimal" disabled={!canRate} placeholder="—" value={r('RETAIL')} onChange={(e) => set('RETAIL', e.target.value)} /></Affix>
                  <div>
                    <Affix prefix="Rs"><input aria-label={`Wholesale rate per ${unitLabel(u.unitName)}`} type="number" step="any" min="0" inputMode="decimal" disabled={!canRate} placeholder={r('RETAIL') ? `${r('RETAIL')} (retail)` : '—'} value={r('WHOLESALE')} onChange={(e) => set('WHOLESALE', e.target.value)} /></Affix>
                    {retail > 0 && whole > 0 && <span className={`rate-diff${whole > retail ? ' warn' : ''}`}>{whole > retail ? 'above retail' : `${money(retail - whole)} less (${Math.round(((retail - whole) / retail) * 100)}%)`}</span>}
                  </div>
                </Fragment>
              );
            })}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <BusyButton busy={busy} disabled={!canEdit && !canRate}>{product ? 'Save changes' : 'Add product'}</BusyButton>
          </div>
        </form>
      </div>
    </div>
  );
}
