'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BusyButton, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import {
  DRINK_CATALOG, DRINK_SIZE_PRESETS, RICE_PACKINGS, RICE_VARIETIES, defaultPack, drinkSpecs, productKey, riceSpecs, round2, sizeMl,
  type DrinkBrand, type DrinkSize, type ProductSpec, type RicePacking,
} from '@dist/shared';

type Tab = 'drinks' | 'rice';
type Group = DrinkBrand['group'];
const GROUPS: Group[] = ['Soft drinks', 'Energy drinks', 'Juices', 'Water'];
const CHUNK = 100;

const brandKey = (b: DrinkBrand) => b.category.join('/');
const pick = (bk: string, name: string, size: string) => `${bk}||${name}||${size}`;
const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

/** Sizes in order of volume; a size whose volume cannot be read keeps its place. */
const byVolume = (sizes: DrinkSize[]) => [...sizes].sort((a, b) => (a.ml || 0) - (b.ml || 0));

interface Edit { pack?: string; returnable?: boolean; sale?: string }
interface CustomRice { type: string; variety: string; forms: string[] }

/** A little form that opens under a button: a size with its pack and whether the bottle comes back. */
function SizeForm({ onAdd, onCancel, note }: { onAdd: (s: DrinkSize) => void; onCancel: () => void; note?: string }) {
  const [size, setSize] = useState('');
  const [pack, setPack] = useState('');
  const [returnable, setReturnable] = useState(false);
  const guess = size.trim() ? defaultPack(size) : null;
  const ml = sizeMl(size);
  const ready = size.trim().length >= 2 && Number(pack || guess?.pack || 0) >= 1;
  const submit = () => {
    if (!ready) return;
    const label = size.trim().replace(/\s+/g, ' ');
    onAdd({ size: label, ml: ml ?? 0, pack: Number(pack || guess?.pack || 1), returnable: returnable || !!guess?.returnable, kind: /glass/i.test(label) ? 'glass' : /can/i.test(label) ? 'can' : /tetra/i.test(label) ? 'tetra' : 'PET' });
  };
  return (
    <div className="cat-inline" role="group" aria-label="Add a size">
      <div className="cat-inline-row">
        <label>Size<input autoFocus value={size} maxLength={30} placeholder="e.g. 2 L or 330 ml can" onChange={(e) => { setSize(e.target.value); setPack(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } if (e.key === 'Escape') onCancel(); }} /></label>
        <label>Bottles per peti<input type="number" min={1} inputMode="numeric" value={pack} placeholder={guess ? String(guess.pack) : '6'} onChange={(e) => setPack(e.target.value)} /></label>
      </div>
      <label className="cat-check"><input type="checkbox" checked={returnable || !!guess?.returnable} onChange={(e) => setReturnable(e.target.checked)} />Returnable glass bottle (empties tracked)</label>
      {note && <small className="muted">{note}</small>}
      <div className="cat-inline-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="button" disabled={!ready} onClick={submit}><Icon name="plus" />Add size</button></div>
    </div>
  );
}

/**
 * Pick what you stock from a starter list of Pakistani drinks and rice and add it in one go.
 * Anything missing can be added on the spot: a size, a flavour, a whole brand, a bag weight or a rice variety.
 * Pack sizes come filled in, and a review step lets you correct them and type the sale rates before anything is saved.
 */
export default function CatalogPage() {
  usePageTitle('Add from catalog');
  const router = useRouter();
  const toast = useToast();
  const user = useUser();
  const canRate = can(user, 'RATE_EDIT');
  const [tab, setTab] = useState<Tab>('drinks');
  const [have, setHave] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);

  // drinks
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extraSizes, setExtraSizes] = useState<Record<string, DrinkSize[]>>({});
  const [extraProducts, setExtraProducts] = useState<Record<string, string[]>>({});
  const [customBrands, setCustomBrands] = useState<DrinkBrand[]>([]);
  const [open, setOpen] = useState<{ kind: 'size' | 'flavour'; key: string } | 'all-size' | 'brand' | null>(null);
  const [flavour, setFlavour] = useState('');
  const [brandForm, setBrandForm] = useState<{ name: string; company: string; group: Group }>({ name: '', company: '', group: 'Soft drinks' });

  // rice
  const [rice, setRice] = useState<Set<string>>(new Set());
  const [packings, setPackings] = useState<Set<RicePacking | number>>(new Set(['loose']));
  const [customBags, setCustomBags] = useState<number[]>([]);
  const [bagInput, setBagInput] = useState('');
  const [customRice, setCustomRice] = useState<CustomRice[]>([]);
  const [riceForm, setRiceForm] = useState<{ type: string; variety: string; forms: string } | null>(null);

  // review
  const [edits, setEdits] = useState<Record<string, Edit>>({});

  useEffect(() => {
    api<{ name: string; size: string | null }[]>('/products?includeInactive=true')
      .then((p) => setHave(new Set(p.map((x) => productKey(x.name, x.size)))))
      .catch((e) => toast.error(e.message));
  }, [toast]);

  const exists = (name: string, size: string | null) => !!have?.has(productKey(name, size));

  /** The starter brands plus what was added here: extra flavours, extra sizes, own brands. */
  const brands = useMemo<DrinkBrand[]>(() => [...DRINK_CATALOG, ...customBrands].map((b) => {
    const k = brandKey(b);
    const products = [...b.products, ...(extraProducts[k] ?? []).filter((n) => !b.products.some((x) => x.toLowerCase() === n.toLowerCase()))];
    const extra = (extraSizes[k] ?? []).filter((s) => !b.sizes.some((x) => x.size.toLowerCase() === s.size.toLowerCase()));
    return { ...b, products, sizes: extra.length ? byVolume([...b.sizes, ...extra]) : b.sizes };
  }), [customBrands, extraProducts, extraSizes]);

  const specs = useMemo<ProductSpec[]>(() => {
    const out: ProductSpec[] = [];
    for (const b of brands) {
      const bk = brandKey(b);
      for (const name of b.products) {
        const sizes = b.sizes.filter((s) => picked.has(pick(bk, name, s.size)));
        if (sizes.length) out.push(...drinkSpecs(b, name, sizes));
      }
    }
    for (const key of rice) {
      const [type, variety, form] = key.split('|');
      out.push(...riceSpecs(type, variety, form, [...packings]));
    }
    return out.filter((s) => !exists(s.name, s.size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brands, picked, rice, packings, have]);

  const q = search.trim().toLowerCase();
  const brandsShown = brands.filter((b) => !q || `${b.company} ${b.products.join(' ')} ${b.category.join(' ')} ${b.sizes.map((s) => s.size).join(' ')}`.toLowerCase().includes(q));

  /** Every size on offer, once, with how many brand products carry it: the "pick a size everywhere" bar. */
  const sizeBar = useMemo(() => {
    const m = new Map<string, { size: string; ml: number; slots: string[] }>();
    for (const b of brandsShown) {
      const bk = brandKey(b);
      for (const s of b.sizes) {
        const e = m.get(s.size.toLowerCase()) ?? { size: s.size, ml: s.ml, slots: [] };
        for (const name of b.products) if (!exists(name, s.size)) e.slots.push(pick(bk, name, s.size));
        m.set(s.size.toLowerCase(), e);
      }
    }
    return [...m.values()].filter((e) => e.slots.length).sort((a, b) => a.ml - b.ml);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandsShown, have]);

  // ---- editing the lists
  const addSizeToBrand = (b: DrinkBrand, s: DrinkSize) => {
    const k = brandKey(b);
    setExtraSizes((x) => ({ ...x, [k]: [...(x[k] ?? []), s] }));
    setPicked((p) => { const n = new Set(p); for (const name of b.products) if (!exists(name, s.size)) n.add(pick(k, name, s.size)); return n; });
  };
  const addSizeEverywhere = (s: DrinkSize) => {
    setExtraSizes((x) => { const n = { ...x }; for (const b of brandsShown) n[brandKey(b)] = [...(n[brandKey(b)] ?? []), s]; return n; });
    setPicked((p) => { const n = new Set(p); for (const b of brandsShown) for (const name of b.products) if (!exists(name, s.size)) n.add(pick(brandKey(b), name, s.size)); return n; });
    setOpen(null);
    toast.success(`${s.size} added to ${brandsShown.length} brands and ticked`);
  };
  const addFlavour = (b: DrinkBrand) => {
    const name = flavour.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return;
    const k = brandKey(b);
    if (b.products.some((x) => x.toLowerCase() === name.toLowerCase())) { toast.error(`${name} is already listed under ${b.category[b.category.length - 1]}`); return; }
    setExtraProducts((x) => ({ ...x, [k]: [...(x[k] ?? []), name] }));
    setFlavour('');
    setOpen(null);
  };
  const addBrand = () => {
    const name = brandForm.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return;
    const path = brandForm.group === 'Soft drinks' ? [name] : [brandForm.group, name];
    if (brands.some((b) => brandKey(b).toLowerCase() === path.join('/').toLowerCase())) { toast.error(`${name} is already in the list`); return; }
    setCustomBrands((c) => [...c, { group: brandForm.group, category: path, company: brandForm.company.trim() || name, products: [name], sizes: DRINK_SIZE_PRESETS }]);
    setBrandForm({ name: '', company: '', group: brandForm.group });
    setOpen(null);
  };

  const addCustomRice = () => {
    if (!riceForm) return;
    const variety = riceForm.variety.trim().replace(/\s+/g, ' ');
    const forms = [...new Set(riceForm.forms.split(',').map((f) => f.trim()).filter(Boolean))];
    if (variety.length < 1 || !forms.length) return;
    setCustomRice((c) => [...c, { type: riceForm.type, variety, forms }]);
    setRice((r) => { const n = new Set(r); for (const f of forms) n.add(`${riceForm.type}|${variety}|${f}`); return n; });
    setRiceForm(null);
  };
  const addBag = () => {
    const kg = Number(bagInput);
    if (!(kg > 0) || kg > 200) return;
    if (!RICE_PACKINGS.some((p) => p.bagKg === kg) && !customBags.includes(kg)) setCustomBags((c) => [...c, kg]);
    setPackings((p) => new Set(p).add(RICE_PACKINGS.find((x) => x.bagKg === kg)?.key ?? kg));
    setBagInput('');
  };

  // ---- adding
  const keyOf = (s: ProductSpec) => productKey(s.name, s.size);
  const edit = (s: ProductSpec, patch: Edit) => setEdits((e) => ({ ...e, [keyOf(s)]: { ...e[keyOf(s)], ...patch } }));
  const finalSpecs = specs.map((s) => ({ ...s, packSize: Number(edits[keyOf(s)]?.pack) >= 1 ? Math.round(Number(edits[keyOf(s)]!.pack)) : s.packSize, returnableEmpty: edits[keyOf(s)]?.returnable ?? s.returnableEmpty }));
  const rated = canRate ? finalSpecs.filter((s) => Number(edits[keyOf(s)]?.sale) > 0) : [];

  async function add() {
    setBusy(true);
    try {
      const created: { id: string; name: string; size: string | null }[] = [];
      let skipped = 0;
      for (let i = 0; i < finalSpecs.length; i += CHUNK) {
        const r = await api<{ created: { id: string; name: string; size: string | null }[]; skipped: unknown[] }>('/products/bulk', { method: 'POST', json: { items: finalSpecs.slice(i, i + CHUNK) } });
        created.push(...r.created);
        skipped += r.skipped.length;
      }
      // Rates typed in the review go in right after, so the new products can be sold at once.
      let failed = 0;
      const byKey = new Map(created.map((c) => [productKey(c.name, c.size), c.id]));
      for (let i = 0; i < rated.length; i += 10) {
        const out = await Promise.allSettled(rated.slice(i, i + 10).flatMap((s) => {
          const id = byKey.get(keyOf(s));
          const sale = Number(edits[keyOf(s)]!.sale);
          if (!id) return [];
          const prices = s.line === 'BOTTLES'
            ? [{ unitName: 'CARTON', rate: sale }, { unitName: 'BOTTLE', rate: round2(sale / s.packSize) }]
            : s.isPacked
              ? [{ unitName: 'BAG', rate: sale }, { unitName: 'KG', rate: round2(sale / (s.bagKg ?? 1)) }]
              : [{ unitName: 'MAUND', rate: sale }, { unitName: 'KG', rate: round2(sale / 40) }, ...(s.bagKg ? [{ unitName: 'BAG', rate: round2((sale / 40) * s.bagKg) }] : [])];
          return [api(`/product-prices/${id}`, { method: 'PUT', json: { prices } })];
        }));
        failed += out.filter((o) => o.status === 'rejected').length;
      }
      toast.success(`${created.length} product${created.length === 1 ? '' : 's'} added${skipped ? `, ${skipped} already there` : ''}${rated.length ? (failed ? `. ${failed} rate${failed === 1 ? '' : 's'} could not be saved; set them in Products` : '. Rates saved too') : '. Set their rates next'}.`);
      router.push('/products');
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const sizeChip = (b: DrinkBrand, name: string, s: DrinkSize) => {
    const key = pick(brandKey(b), name, s.size);
    const added = exists(name, s.size);
    const on = picked.has(key);
    return (
      <button key={key} type="button" className={`size-chip${on ? ' on' : ''}${added ? ' added' : ''}`} disabled={added} aria-pressed={on}
        title={added ? 'Already in Products' : `${s.pack} per peti${s.returnable ? ' · returnable glass' : ''}`}
        onClick={() => setPicked(toggle(picked, key))}>
        {added ? <Icon name="check" /> : null}
        <b>{s.size}</b>
        <span>{s.pack}/peti{s.returnable ? ' · ♻' : ''}</span>
      </button>
    );
  };

  const brandCard = (b: DrinkBrand) => {
    const k = brandKey(b);
    const total = b.products.length * b.sizes.length;
    const done = b.products.reduce((n, name) => n + b.sizes.filter((s) => exists(name, s.size)).length, 0);
    const isCustom = customBrands.some((c) => brandKey(c) === k);
    const adding = typeof open === 'object' && open && open.key === k ? open.kind : null;
    return (
      <div className="card catalog-card" key={k}>
        <div className="card-head" style={{ marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>{b.category[b.category.length - 1]}{isCustom && <span className="badge blue" style={{ marginLeft: 8 }}>Yours</span>}</h3>
            <span className="muted" style={{ fontSize: 12.5 }}>{b.company}{done ? ` · ${done} of ${total} added` : ''}</span>
          </div>
          <div className="btn-row">
            {isCustom && <button type="button" className="chip" aria-label={`Remove ${b.category[b.category.length - 1]}`} onClick={() => { setCustomBrands((c) => c.filter((x) => brandKey(x) !== k)); setPicked((p) => new Set([...p].filter((x) => !x.startsWith(`${k}||`)))); }}>Remove</button>}
            <button type="button" className="chip" onClick={() => {
              const keys = b.products.flatMap((n) => b.sizes.filter((s) => !exists(n, s.size)).map((s) => pick(k, n, s.size)));
              const all = keys.length > 0 && keys.every((x) => picked.has(x));
              const n = new Set(picked); keys.forEach((x) => (all ? n.delete(x) : n.add(x))); setPicked(n);
            }}>All sizes</button>
          </div>
        </div>
        {b.products.map((name) => (
          <div key={name} className="catalog-product">
            {b.products.length > 1 && <span className="catalog-name">{name.replace(/^.*? (?=\S+$)/, '')}</span>}
            <div className="size-chips">{b.sizes.map((s) => sizeChip(b, name, s))}</div>
          </div>
        ))}
        <div className="cat-more">
          <button type="button" className="cat-link" onClick={() => setOpen(adding === 'size' ? null : { kind: 'size', key: k })}><Icon name="plus" />Other size</button>
          <button type="button" className="cat-link" onClick={() => { setFlavour(''); setOpen(adding === 'flavour' ? null : { kind: 'flavour', key: k }); }}><Icon name="plus" />Flavour</button>
        </div>
        {adding === 'size' && <SizeForm onCancel={() => setOpen(null)} onAdd={(s) => { addSizeToBrand(b, s); setOpen(null); }} note={`Added to every product of ${b.category[b.category.length - 1]} and ticked.`} />}
        {adding === 'flavour' && (
          <div className="cat-inline" role="group" aria-label="Add a flavour">
            <label>Flavour or product name<input autoFocus value={flavour} maxLength={80} placeholder={`e.g. ${b.products[0]} Zero`} onChange={(e) => setFlavour(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addFlavour(b); } if (e.key === 'Escape') setOpen(null); }} /></label>
            <div className="cat-inline-actions"><button type="button" className="secondary" onClick={() => setOpen(null)}>Cancel</button><button type="button" disabled={flavour.trim().length < 2} onClick={() => addFlavour(b)}><Icon name="plus" />Add</button></div>
          </div>
        )}
      </div>
    );
  };

  // ---- rice view
  const riceTypes = RICE_VARIETIES.map(({ type, varieties }) => {
    const all = [...varieties, ...customRice.filter((c) => c.type === type).map((c) => ({ variety: c.variety, forms: c.forms }))];
    return { type, varieties: all, forms: [...new Set(all.flatMap((v) => v.forms))] };
  });
  const packOptions = [...RICE_PACKINGS.map((p) => ({ key: p.key as RicePacking | number, label: p.label })), ...customBags.map((kg) => ({ key: kg as RicePacking | number, label: `${kg} kg bag` }))];

  const reviewRows = finalSpecs;
  const drinksRows = reviewRows.filter((s) => s.line === 'BOTTLES');
  const riceRows = reviewRows.filter((s) => s.line === 'RICE');

  const reviewTable = (rows: ProductSpec[], kind: 'drinks' | 'rice') => rows.length > 0 && (
    <div className="table-wrap">
      <table className="review-table">
        <thead>
          <tr>
            <th>Product</th>{kind === 'drinks' ? <><th className="num">Per peti</th><th className="c">♻</th></> : <th>Sold by</th>}
            {canRate && <th className="num">{kind === 'drinks' ? 'Rate per peti' : 'Rate'}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const e = edits[keyOf(s)] ?? {};
            return (
              <tr key={keyOf(s)}>
                <td><b>{s.name}</b>{s.size ? <span className="muted"> · {s.size}</span> : null}</td>
                {kind === 'drinks' ? (
                  <>
                    <td className="num"><input type="number" min={1} inputMode="numeric" className="mini" aria-label={`Bottles per peti for ${s.name} ${s.size ?? ''}`} value={e.pack ?? String(s.packSize)} onChange={(ev) => edit(s, { pack: ev.target.value })} /></td>
                    <td className="c"><input type="checkbox" aria-label={`Returnable ${s.name} ${s.size ?? ''}`} checked={s.returnableEmpty} onChange={(ev) => edit(s, { returnable: ev.target.checked })} /></td>
                  </>
                ) : <td className="muted">{s.isPacked ? `bag of ${s.bagKg} kg` : 'by weight (maund / kg)'}</td>}
                {canRate && (
                  <td className="num">
                    <span className="rate-in"><small>Rs</small><input type="number" min={0} step="any" inputMode="decimal" className="mini wide" placeholder="—" aria-label={`Sale rate for ${s.name} ${s.size ?? ''}`} value={e.sale ?? ''} onChange={(ev) => edit(s, { sale: ev.target.value })} />{kind === 'rice' && <small>{s.isPacked ? '/ bag' : '/ maund'}</small>}</span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Link className="back" href="/products"><Icon name="chevronLeft" />Products</Link>
      <div className="page-head">
        <div>
          <h1>Add from catalog</h1>
          <p>Tick what you stock. Can&apos;t find a size, flavour or brand? Add it right here. Review the packs and type the rates before saving.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'drinks'} onClick={() => setTab('drinks')}>Drinks, juices &amp; water</button>
        <button role="tab" aria-selected={tab === 'rice'} onClick={() => setTab('rice')}>Rice</button>
      </div>

      {tab === 'drinks' && (
        <>
          <div className="list-head">
            <div className="filter"><Icon name="search" /><input aria-label="Search brands" placeholder="Search brand, flavour or size…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <span className="muted" style={{ fontSize: 13 }}>♻ = returnable glass bottle (empties tracked)</span>
          </div>

          <section className="card size-bar-card">
            <div className="card-head" style={{ marginBottom: 8 }}>
              <div><h3 style={{ margin: 0 }}>Pick a size for every brand</h3><span className="muted" style={{ fontSize: 12.5 }}>One tap ticks that size on all the brands below that carry it.</span></div>
              <button type="button" className="cat-link" onClick={() => setOpen(open === 'all-size' ? null : 'all-size')}><Icon name="plus" />Other size for all brands</button>
            </div>
            <div className="chips" role="group" aria-label="Sizes">
              {sizeBar.map((e) => {
                const on = e.slots.every((x) => picked.has(x));
                const some = !on && e.slots.some((x) => picked.has(x));
                return (
                  <button key={e.size} type="button" className={`chip${on ? ' on' : ''}${some ? ' some' : ''}`} aria-pressed={on} onClick={() => setPicked((p) => { const n = new Set(p); e.slots.forEach((x) => (on ? n.delete(x) : n.add(x))); return n; })}>
                    {e.size}<span className="chip-count">{e.slots.length}</span>
                  </button>
                );
              })}
            </div>
            {open === 'all-size' && <SizeForm onCancel={() => setOpen(null)} onAdd={addSizeEverywhere} note="Added to every brand shown below and ticked. Untick the ones you do not stock." />}
          </section>

          {GROUPS.map((g) => {
            const list = brandsShown.filter((b) => b.group === g);
            if (!list.length) return null;
            return (
              <section key={g}>
                <h2>{g}</h2>
                <div className="catalog-grid">{list.map(brandCard)}</div>
              </section>
            );
          })}

          <section>
            <h2>Your own brand</h2>
            <div className="card catalog-card own-brand">
              {open === 'brand' ? (
                <div className="cat-inline" role="group" aria-label="Add a brand" style={{ margin: 0 }}>
                  <div className="cat-inline-row">
                    <label>Brand name<input autoFocus value={brandForm.name} maxLength={40} placeholder="e.g. Cola Next" onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} /></label>
                    <label>Company <span className="muted">(optional)</span><input value={brandForm.company} maxLength={60} onChange={(e) => setBrandForm({ ...brandForm, company: e.target.value })} /></label>
                  </div>
                  <div className="chips" role="radiogroup" aria-label="Kind">
                    {GROUPS.map((g) => <button key={g} type="button" role="radio" aria-checked={brandForm.group === g} className={`chip${brandForm.group === g ? ' on' : ''}`} onClick={() => setBrandForm({ ...brandForm, group: g })}>{g}</button>)}
                  </div>
                  <small className="muted">It appears above with the usual sizes to tick, and you can add flavours and other sizes to it.</small>
                  <div className="cat-inline-actions"><button type="button" className="secondary" onClick={() => setOpen(null)}>Cancel</button><button type="button" disabled={brandForm.name.trim().length < 2} onClick={addBrand}><Icon name="plus" />Add brand</button></div>
                </div>
              ) : (
                <button type="button" className="own-brand-btn" onClick={() => setOpen('brand')}><Icon name="plus" /><span><b>Add a brand that is not listed</b><small>Any drink, juice, water or energy drink you carry</small></span></button>
              )}
            </div>
          </section>
        </>
      )}

      {tab === 'rice' && (
        <>
          <section className="card">
            <h3>How it is sold</h3>
            <p className="card-sub" style={{ margin: '0 0 12px' }}>Each ticked variety is added once per packing. Loose rice sells by kg and maund, with a 50 kg bori unit; packed rice sells by the bag.</p>
            <div className="chips">
              {packOptions.map((p) => (
                <button key={String(p.key)} type="button" className={`chip${packings.has(p.key) ? ' on' : ''}`} aria-pressed={packings.has(p.key)} onClick={() => setPackings(toggle(packings, p.key))}>{p.label}</button>
              ))}
              <span className="cat-bag">
                <input type="number" min={1} max={200} step="any" inputMode="decimal" placeholder="Other kg" aria-label="Another bag weight in kg" value={bagInput} onChange={(e) => setBagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBag(); } }} />
                <button type="button" className="secondary" disabled={!(Number(bagInput) > 0)} onClick={addBag}><Icon name="plus" />Bag</button>
              </span>
            </div>
          </section>
          {riceTypes.map(({ type, varieties, forms }) => (
            <section key={type}>
              <h2>{type}</h2>
              <div className="table-wrap">
                <table className="rice-grid">
                  <thead><tr><th>Variety</th>{forms.map((f) => <th key={f} className="c">{f}</th>)}</tr></thead>
                  <tbody>
                    {varieties.map(({ variety, forms: vForms }) => (
                      <tr key={variety}>
                        <td><b>{variety}</b>{customRice.some((c) => c.type === type && c.variety === variety) && <span className="badge blue" style={{ marginLeft: 8 }}>Yours</span>}</td>
                        {forms.map((f) => {
                          if (!vForms.includes(f)) return <td key={f} className="c muted">—</td>;
                          const key = `${type}|${variety}|${f}`;
                          const added = packings.size > 0 && riceSpecs(type, variety, f, [...packings]).every((s) => exists(s.name, s.size));
                          return (
                            <td key={f} className="c">
                              <label className="rice-check" title={added ? 'Already in Products' : `${variety} ${f}`}>
                                <input type="checkbox" disabled={added} checked={added || rice.has(key)} onChange={() => setRice(toggle(rice, key))} aria-label={`${variety} ${f}`} />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          <section className="card own-brand">
            {riceForm ? (
              <div className="cat-inline" role="group" aria-label="Add a rice variety" style={{ margin: 0 }}>
                <div className="cat-inline-row">
                  <label>Variety<input autoFocus value={riceForm.variety} maxLength={40} placeholder="e.g. Super Fine" onChange={(e) => setRiceForm({ ...riceForm, variety: e.target.value })} /></label>
                  <label>Forms <span className="muted">(separate with commas)</span><input value={riceForm.forms} maxLength={80} onChange={(e) => setRiceForm({ ...riceForm, forms: e.target.value })} /></label>
                </div>
                <div className="chips" role="radiogroup" aria-label="Type">
                  {RICE_VARIETIES.map((t) => <button key={t.type} type="button" role="radio" aria-checked={riceForm.type === t.type} className={`chip${riceForm.type === t.type ? ' on' : ''}`} onClick={() => setRiceForm({ ...riceForm, type: t.type })}>{t.type}</button>)}
                </div>
                <div className="cat-inline-actions"><button type="button" className="secondary" onClick={() => setRiceForm(null)}>Cancel</button><button type="button" disabled={!riceForm.variety.trim() || !riceForm.forms.trim()} onClick={addCustomRice}><Icon name="plus" />Add variety</button></div>
              </div>
            ) : (
              <button type="button" className="own-brand-btn" onClick={() => setRiceForm({ type: 'Basmati', variety: '', forms: 'White, Sella, Steam' })}><Icon name="plus" /><span><b>Add a rice variety that is not listed</b><small>It appears in its type above with the forms you give</small></span></button>
            )}
          </section>
        </>
      )}

      <div className="catalog-bar" role="region" aria-label="Selection">
        <span>{have === null ? 'Checking what you already have…' : specs.length ? <><b>{specs.length}</b> new product{specs.length === 1 ? '' : 's'} selected</> : 'Nothing selected yet'}</span>
        <div className="actions">
          {(picked.size > 0 || rice.size > 0) && <button type="button" className="secondary" onClick={() => { setPicked(new Set()); setRice(new Set()); }}>Clear</button>}
          <BusyButton busy={false} disabled={!specs.length} onClick={() => setReview(true)}><Icon name="check" />Review &amp; add</BusyButton>
        </div>
      </div>

      {review && (
        <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setReview(false); }}>
          <aside className="drawer wide" role="dialog" aria-modal="true" aria-labelledby="review-title" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setReview(false); }}>
            <header className="drawer-head">
              <span className="drawer-icon"><Icon name="products" /></span>
              <div><h2 id="review-title">Review {specs.length} product{specs.length === 1 ? '' : 's'}</h2><p>Correct a pack if yours differs{canRate ? ', and type the sale rates now to start selling at once. Rates can stay empty.' : '.'}</p></div>
              <button type="button" className="drawer-x" onClick={() => setReview(false)} aria-label="Close"><Icon name="x" /></button>
            </header>
            <div className="drawer-body">
              {drinksRows.length > 0 && <><h3 className="review-title">Drinks ({drinksRows.length})</h3>{reviewTable(drinksRows, 'drinks')}</>}
              {riceRows.length > 0 && <><h3 className="review-title">Rice ({riceRows.length})</h3>{reviewTable(riceRows, 'rice')}</>}
              {!canRate && <p className="muted" style={{ marginTop: 14 }}>You do not have permission to set rates; ask the owner to set them in Products.</p>}
            </div>
            <footer className="drawer-foot">
              <span className="drawer-note">{rated.length ? `${rated.length} with a rate` : 'No rates typed'}</span>
              <button type="button" className="secondary" disabled={busy} onClick={() => setReview(false)}>Back</button>
              <BusyButton busy={busy} onClick={add}><Icon name="plus" />{busy ? 'Adding…' : `Add ${specs.length} product${specs.length === 1 ? '' : 's'}`}</BusyButton>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}
