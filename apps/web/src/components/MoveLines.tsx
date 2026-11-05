'use client';

import { useMemo } from 'react';
import Combobox from '@/components/Combobox';
import { Icon } from '@/components/Icon';
import { productOptions, type ProductOpt } from '@/lib/lookups';
import { unitLabel } from '@dist/shared';

export interface MoveLine { productId: string; unitName: string; qty: string }
export const EMPTY_MOVE: MoveLine = { productId: '', unitName: '', qty: '' };
const COLS = 'minmax(180px, 2.4fr) 110px 90px 110px 36px';

/** The units a product can be moved in, labelled the way people say them ("peti (6)"). */
export function UnitSelect({ product, value, onChange }: { product?: ProductOpt; value: string; onChange: (v: string) => void }) {
  return (
    <select aria-label="Unit" value={value} disabled={!product} onChange={(e) => onChange(e.target.value)} required>
      {product?.units.map((u) => <option key={u.unitName} value={u.unitName}>{unitLabel(u.unitName)}{Number(u.factorToBase) !== 1 ? ` (${Number(u.factorToBase)})` : ''}</option>)}
    </select>
  );
}

/**
 * Item rows for moving stock (transfers, loading a vehicle): product, unit, quantity and what is
 * available at the source. `available` returns the text to show for a product.
 */
export default function MoveLines({ id, products, lines, onChange, available, note, optional }: {
  id: string; products: ProductOpt[]; lines: MoveLine[]; onChange: (l: MoveLine[]) => void;
  available: (productId: string) => string; note?: string;
  /** A single blank row may be left empty (nothing to move). */
  optional?: boolean;
}) {
  const required = !(optional && lines.length === 1 && !lines[0].productId && !lines[0].qty);
  const opts = useMemo(() => productOptions(products), [products]);
  const prod = (pid: string) => products.find((p) => p.id === pid);
  const set = (i: number, patch: Partial<MoveLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="items" style={{ gridColumn: '1 / -1' }}>
      <div className="items-head" style={{ gridTemplateColumns: COLS }}><span>Product</span><span>Unit</span><span className="r">Qty</span><span className="r">Available</span><span /></div>
      {lines.map((l, i) => (
        <div className="items-row" key={i} style={{ gridTemplateColumns: COLS }}>
          <div className="item-product">
            <Combobox id={`${id}-product-${i}`} ariaLabel="Product" required={required} compact options={opts} value={l.productId} recentKey="product" placeholder="Type product name…"
              onChange={(v) => set(i, { productId: v, unitName: prod(v)?.units.find((u) => u.unitName === 'CARTON')?.unitName ?? prod(v)?.units[0]?.unitName ?? '' })} />
          </div>
          <UnitSelect product={prod(l.productId)} value={l.unitName} onChange={(v) => set(i, { unitName: v })} />
          <input aria-label="Quantity" className="r" type="number" step="any" min="0" required={required} inputMode="decimal" placeholder="0" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
          <span className="r muted">{available(l.productId)}</span>
          <button type="button" className="icon-btn" aria-label="Remove item" disabled={lines.length === 1} onClick={() => onChange(lines.filter((_, j) => j !== i))}><Icon name="x" /></button>
        </div>
      ))}
      <div className="items-foot">
        <button type="button" className="add" onClick={() => onChange([...lines, { ...EMPTY_MOVE }])}><Icon name="plus" />Add item</button>
        {note && <span className="muted">{note}</span>}
      </div>
    </div>
  );
}

/** Lines ready for the API: filled rows only, quantities as numbers. */
export const moveItems = (lines: MoveLine[]) => lines.filter((l) => l.productId && Number(l.qty) > 0).map((l) => ({ productId: l.productId, unitName: l.unitName, qty: Number(l.qty) }));
