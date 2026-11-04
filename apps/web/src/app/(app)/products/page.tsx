'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';

type Line = 'BOTTLES' | 'RICE';
interface Category { id: string; name: string; parentId: string | null; businessLine: { code: Line } }
interface Product {
  id: string; name: string; brand: string | null; size: string | null; returnableEmpty: boolean;
  units: { unitName: string; factorToBase: string }[];
  category: { name: string; businessLine: { code: Line } };
}

const EMPTY = { name: '', brand: '', size: '', categoryId: '', packSize: '6', bagKg: '', returnableEmpty: true };

export default function ProductsPage() {
  const [line, setLine] = useState<Line>('BOTTLES');
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('');
  const canEdit = can(useUser(), 'MASTER_DATA_EDIT');

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api<Product[]>(`/products?line=${line}`), api<Category[]>(`/categories?line=${line}`)]);
      setProducts(p);
      setCategories(c);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [line]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // "Basmati › Super Kernel › Sella" labels, only leaf categories can hold products in practice but any level is allowed.
  const label = (c: Category): string => {
    const parent = categories.find((x) => x.id === c.parentId);
    return parent ? `${label(parent)} › ${c.name}` : c.name;
  };
  const options = categories.map((c) => ({ id: c.id, text: label(c) })).sort((a, b) => a.text.localeCompare(b.text));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const bottles = line === 'BOTTLES';
    const units = bottles
      ? [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: Number(form.packSize) }]
      : [
          { unitName: 'KG', factorToBase: 1 },
          { unitName: 'MAUND', factorToBase: 40 },
          ...(form.bagKg ? [{ unitName: 'BAG', factorToBase: Number(form.bagKg) }] : []),
        ];
    try {
      await api('/products', {
        method: 'POST',
        json: {
          categoryId: form.categoryId,
          name: form.name,
          brand: form.brand || undefined,
          size: form.size || undefined,
          baseUnit: bottles ? 'BOTTLE' : 'KG',
          isPacked: !bottles && !!form.bagKg,
          returnableEmpty: bottles && form.returnableEmpty,
          units,
        },
      });
      setForm({ ...EMPTY, categoryId: form.categoryId });
      setAdding(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const set = (patch: Partial<typeof EMPTY>) => setForm({ ...form, ...patch });

  return (
    <>
      <div className="page-head">
        <div><h1>Products</h1><p>{products.length} {line === 'BOTTLES' ? 'bottle' : 'rice'} products</p></div>
        {canEdit && !adding && <button onClick={() => setAdding(true)}>+ Add product</button>}
      </div>
      <div className="list-head">
        {(['BOTTLES', 'RICE'] as Line[]).map((l) => (
          <button key={l} className={`chip${line === l ? ' on' : ''}`} onClick={() => { setLine(l); setForm(EMPTY); }}>
            {l === 'BOTTLES' ? 'Bottles' : 'Rice'}
          </button>
        ))}
        <div className="filter"><Icon name="search" /><input placeholder="Filter products…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      </div>
      {error && <p className="error">{error}</p>}
      {canEdit && adding && (
        <form className="card form" onSubmit={submit}>
          <p className="form-title">New {line === 'BOTTLES' ? 'bottle' : 'rice'} product</p>
          <label>Category
            <select required value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
              <option value="">—</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
            </select>
          </label>
          <label>Name<input required value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>Brand<input value={form.brand} onChange={(e) => set({ brand: e.target.value })} /></label>
          <label>Size<input value={form.size} placeholder={line === 'BOTTLES' ? '1.5 L' : '25 kg'} onChange={(e) => set({ size: e.target.value })} /></label>
          {line === 'BOTTLES' ? (
            <>
              <label>Bottles per carton<input type="number" min="1" required value={form.packSize} onChange={(e) => set({ packSize: e.target.value })} /></label>
              <label>Returnable empty
                <input type="checkbox" checked={form.returnableEmpty} onChange={(e) => set({ returnableEmpty: e.target.checked })} />
              </label>
            </>
          ) : (
            <label>Bag size (kg, if packed)<input type="number" step="any" min="0" value={form.bagKg} onChange={(e) => set({ bagKg: e.target.value })} /></label>
          )}
          <div className="form-actions">
            <button>Save product</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
      <table>
        <thead><tr><th>Name</th><th>Category</th><th>Size</th><th>Units (per base)</th></tr></thead>
        <tbody>
          {products.filter((p) => `${p.name} ${p.brand ?? ''} ${p.size ?? ''} ${p.category.name}`.toLowerCase().includes(filter.trim().toLowerCase())).map((p) => (
            <tr key={p.id}>
              <td><strong>{p.name}</strong>{p.brand && <span className="muted"> · {p.brand}</span>}</td>
              <td>{p.category.name}</td>
              <td>{p.size}</td>
              <td>{p.units.map((u) => <span key={u.unitName} className="badge blue" style={{ marginRight: 6 }}>{u.unitName.toLowerCase()} = {Number(u.factorToBase)}</span>)}{p.returnableEmpty && <span className="badge amber">returnable</span>}</td>
            </tr>
          ))}
          {!products.length && <tr><td colSpan={4} className="empty">No products yet. Add one or use Import.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
