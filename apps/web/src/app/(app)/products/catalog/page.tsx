'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { BusyButton, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import {
  DRINK_CATALOG, RICE_PACKINGS, RICE_VARIETIES, drinkSpecs, productKey, riceSpecs,
  type DrinkBrand, type DrinkSize, type ProductSpec, type RicePacking,
} from '@dist/shared';

type Tab = 'drinks' | 'rice';
const GROUPS: DrinkBrand['group'][] = ['Soft drinks', 'Energy drinks', 'Juices', 'Water'];

/**
 * Pick what you stock from a starter list of Pakistani drinks and rice and add it in one go.
 * Pack sizes (bottles per peti) come pre-filled; anything already in Products is shown as added.
 */
export default function CatalogPage() {
  usePageTitle('Add from catalog');
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('drinks');
  const [have, setHave] = useState<Set<string> | null>(null);
  const [drinks, setDrinks] = useState<Set<string>>(new Set()); // `${product}|${size}`
  const [rice, setRice] = useState<Set<string>>(new Set()); // `${type}|${variety}|${form}`
  const [packings, setPackings] = useState<Set<RicePacking>>(new Set(['loose']));
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ name: string; size: string | null }[]>('/products?includeInactive=true')
      .then((p) => setHave(new Set(p.map((x) => productKey(x.name, x.size)))))
      .catch((e) => toast.error(e.message));
  }, [toast]);

  const toggle = <T,>(set: Set<T>, v: T) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  const exists = (name: string, size: string | null) => !!have?.has(productKey(name, size));

  const specs = useMemo<ProductSpec[]>(() => {
    const out: ProductSpec[] = [];
    for (const b of DRINK_CATALOG) for (const name of b.products) {
      const sizes = b.sizes.filter((s) => drinks.has(`${name}|${s.size}`));
      if (sizes.length) out.push(...drinkSpecs(b, name, sizes));
    }
    for (const key of rice) {
      const [type, variety, form] = key.split('|');
      out.push(...riceSpecs(type, variety, form, [...packings]));
    }
    return out.filter((s) => !exists(s.name, s.size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drinks, rice, packings, have]);

  async function add() {
    setBusy(true);
    try {
      const r = await api<{ created: unknown[]; skipped: unknown[] }>('/products/bulk', { method: 'POST', json: { items: specs } });
      toast.success(`${r.created.length} product${r.created.length === 1 ? '' : 's'} added${r.skipped.length ? `, ${r.skipped.length} already there` : ''}. Set their rates next.`);
      router.push('/products');
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  const q = search.trim().toLowerCase();
  const brandsShown = DRINK_CATALOG.filter((b) => !q || `${b.company} ${b.products.join(' ')} ${b.category.join(' ')}`.toLowerCase().includes(q));

  const sizeChip = (name: string, s: DrinkSize) => {
    const key = `${name}|${s.size}`;
    const added = exists(name, s.size);
    const on = drinks.has(key);
    return (
      <button key={key} type="button" className={`size-chip${on ? ' on' : ''}${added ? ' added' : ''}`} disabled={added} aria-pressed={on}
        title={added ? 'Already in Products' : `${s.pack} per peti${s.returnable ? ' · returnable glass' : ''}`}
        onClick={() => setDrinks(toggle(drinks, key))}>
        {added ? <Icon name="check" /> : null}
        <b>{s.size}</b>
        <span>{s.pack}/peti{s.returnable ? ' · ♻' : ''}</span>
      </button>
    );
  };

  return (
    <>
      <Link className="back" href="/products"><Icon name="chevronLeft" />Products</Link>
      <div className="page-head">
        <div>
          <h1>Add from catalog</h1>
          <p>Tick what you stock. Bottles per peti come filled in from common Pakistani packs — you can change any product later.</p>
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'drinks'} onClick={() => setTab('drinks')}>Drinks, juices &amp; water</button>
        <button role="tab" aria-selected={tab === 'rice'} onClick={() => setTab('rice')}>Rice</button>
      </div>

      {tab === 'drinks' && (
        <>
          <div className="list-head">
            <div className="filter"><Icon name="search" /><input aria-label="Search brands" placeholder="Search brand or flavour…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <span className="muted" style={{ fontSize: 13 }}>♻ = returnable glass bottle (empties tracked)</span>
          </div>
          {GROUPS.map((g) => {
            const brands = brandsShown.filter((b) => b.group === g);
            if (!brands.length) return null;
            return (
              <section key={g}>
                <h2>{g}</h2>
                <div className="catalog-grid">
                  {brands.map((b) => (
                    <div className="card catalog-card" key={b.category.join('/')}>
                      <div className="card-head" style={{ marginBottom: 10 }}>
                        <div><h3 style={{ margin: 0 }}>{b.category[b.category.length - 1]}</h3><span className="muted" style={{ fontSize: 12.5 }}>{b.company}</span></div>
                        <button type="button" className="chip" onClick={() => {
                          const keys = b.products.flatMap((n) => b.sizes.filter((s) => !exists(n, s.size)).map((s) => `${n}|${s.size}`));
                          const all = keys.every((k) => drinks.has(k));
                          const n = new Set(drinks); keys.forEach((k) => (all ? n.delete(k) : n.add(k))); setDrinks(n);
                        }}>All sizes</button>
                      </div>
                      {b.products.map((name) => (
                        <div key={name} className="catalog-product">
                          {b.products.length > 1 && <span className="catalog-name">{name.replace(/^.*? (?=\S+$)/, '')}</span>}
                          <div className="size-chips">{b.sizes.map((s) => sizeChip(name, s))}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      {tab === 'rice' && (
        <>
          <section className="card">
            <h3>How it is sold</h3>
            <p className="card-sub" style={{ margin: '0 0 12px' }}>Each ticked variety is added once per packing. Loose rice sells by kg and maund, with a 50 kg bori unit; packed rice sells by the bag.</p>
            <div className="chips">
              {RICE_PACKINGS.map((p) => (
                <button key={p.key} type="button" className={`chip${packings.has(p.key) ? ' on' : ''}`} aria-pressed={packings.has(p.key)} onClick={() => setPackings(toggle(packings, p.key))}>{p.label}</button>
              ))}
            </div>
          </section>
          {RICE_VARIETIES.map(({ type, varieties }) => {
            const forms = [...new Set(varieties.flatMap((v) => v.forms))];
            return (
              <section key={type}>
                <h2>{type}</h2>
                <div className="table-wrap">
                  <table className="rice-grid">
                    <thead><tr><th>Variety</th>{forms.map((f) => <th key={f} className="c">{f}</th>)}</tr></thead>
                    <tbody>
                      {varieties.map(({ variety, forms: vForms }) => (
                        <tr key={variety}>
                          <td><b>{variety}</b></td>
                          {forms.map((f) => {
                            if (!vForms.includes(f)) return <td key={f} className="c muted">—</td>;
                            const key = `${type}|${variety}|${f}`;
                            const added = [...packings].length > 0 && riceSpecs(type, variety, f, [...packings]).every((s) => exists(s.name, s.size));
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
            );
          })}
        </>
      )}

      <div className="catalog-bar" role="region" aria-label="Selection">
        <span>{have === null ? 'Checking what you already have…' : specs.length ? <><b>{specs.length}</b> new product{specs.length === 1 ? '' : 's'} selected</> : 'Nothing selected yet'}</span>
        <div className="actions">
          {(drinks.size > 0 || rice.size > 0) && <button type="button" className="secondary" onClick={() => { setDrinks(new Set()); setRice(new Set()); }}>Clear</button>}
          <BusyButton busy={busy} disabled={!specs.length} onClick={add}><Icon name="plus" />Add {specs.length || ''} product{specs.length === 1 ? '' : 's'}</BusyButton>
        </div>
      </div>
    </>
  );
}
