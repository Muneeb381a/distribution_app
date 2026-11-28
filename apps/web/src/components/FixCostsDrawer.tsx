'use client';

import { useEffect, useState } from 'react';
import { BusyButton, Empty, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { formatQty, rupees } from '@dist/shared';

interface Row {
  productId: string; name: string; size: string | null; baseUnit: 'BOTTLE' | 'KG'; isPacked: boolean;
  units: { unitName: string; factorToBase: string }[]; lines: number; qtyBase: string; sales: string; cost: string | null;
}

/** The unit a cost is easiest to say in: what one peti or one bag cost. */
function bigOf(r: Row): { factor: number; word: string } | null {
  const carton = r.units.find((u) => u.unitName === 'CARTON');
  if (carton && Number(carton.factorToBase) > 1) return { factor: Number(carton.factorToBase), word: 'peti' };
  const bag = r.units.find((u) => u.unitName === 'BAG');
  if (bag && Number(bag.factorToBase) > 1) return { factor: Number(bag.factorToBase), word: 'bag' };
  const maund = r.units.find((u) => u.unitName === 'MAUND');
  if (maund && Number(maund.factorToBase) > 1) return { factor: Number(maund.factorToBase), word: 'maund' };
  return null;
}

/**
 * Sold lines that have no cost count as pure profit. This lists those products and takes what one peti (or bag, or kg)
 * cost, then works the past sales out properly. Lines that already have a cost are not touched.
 */
export function FixCostsDrawer({ canFix, onClose, onFixed }: { canFix: boolean; onClose: () => void; onFixed: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [cost, setCost] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Row[]>('/reports/profit/uncosted').then((r) => {
      setRows(r);
      const c: Record<string, string> = {};
      for (const x of r) if (x.cost) c[x.productId] = String(Math.round(Number(x.cost) * (bigOf(x)?.factor ?? 1) * 100) / 100);
      setCost(c);
    }).catch((e) => setError(e.message));
  }, []);

  const items = (rows ?? []).filter((r) => Number(cost[r.productId]) > 0);
  const lines = items.reduce((s, r) => s + r.lines, 0);

  async function save() {
    setBusy(true);
    try {
      const out = await api<{ products: number; lines: number }>('/reports/profit/uncosted/fix', {
        method: 'POST',
        json: { items: items.map((r) => ({ productId: r.productId, unitCostBase: Math.round((Number(cost[r.productId]) / (bigOf(r)?.factor ?? 1)) * 10_000) / 10_000 })) },
      });
      toast.success(`${out.lines} sold line${out.lines === 1 ? '' : 's'} of ${out.products} product${out.products === 1 ? '' : 's'} now have a cost. Profit is worked out again.`);
      onFixed();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <aside className="drawer wide" role="dialog" aria-modal="true" aria-labelledby="fix-title" onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}>
        <header className="drawer-head">
          <span className="drawer-icon"><Icon name="wallet" /></span>
          <div><h2 id="fix-title">Sales with no cost</h2><p>Without a cost the whole sale counts as profit. Type what one peti or bag cost you and the past profit is worked out again.</p></div>
          <button type="button" className="drawer-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </header>
        <div className="drawer-body">
          {error && <p className="error">{error}</p>}
          {!rows && !error && <div className="skeleton" style={{ height: 160 }} />}
          {rows && !rows.length && <Empty icon="check" title="Every sold line has a cost" text="The profit figures are complete." />}
          {rows && rows.length > 0 && (
            <div className="table-wrap">
              <table className="review-table">
                <thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Sales</th><th className="num">Cost of one {rows.some((r) => bigOf(r)) ? 'peti / bag' : 'unit'}</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const b = bigOf(r);
                    return (
                      <tr key={r.productId}>
                        <td><b>{r.name}</b>{r.size ? <span className="muted"> · {r.size}</span> : null}<div className="muted" style={{ fontSize: 12 }}>{r.lines} bill line{r.lines === 1 ? '' : 's'}</div></td>
                        <td className="num">{formatQty(r.qtyBase, r.units, r.baseUnit)}</td>
                        <td className="num">Rs {rupees(r.sales)}</td>
                        <td className="num">
                          <span className="rate-in">
                            <small>Rs</small>
                            <input className="mini wide" type="number" min={0} step="any" inputMode="decimal" disabled={!canFix} placeholder="—" aria-label={`Cost of ${r.name} ${r.size ?? ''}`} value={cost[r.productId] ?? ''} onChange={(e) => setCost({ ...cost, [r.productId]: e.target.value })} />
                            <small>/ {b ? b.word : r.baseUnit === 'KG' ? 'kg' : 'bottle'}</small>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!canFix && rows && rows.length > 0 && <p className="muted" style={{ marginTop: 14 }}>Ask the owner to set these costs; you need permission to adjust stock.</p>}
        </div>
        <footer className="drawer-foot">
          <span className="drawer-note">{items.length ? `${items.length} product${items.length === 1 ? '' : 's'} · ${lines} line${lines === 1 ? '' : 's'}` : 'Type a cost to begin'}</span>
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button>
          {canFix && <BusyButton busy={busy} disabled={!items.length} onClick={save}><Icon name="check" />{busy ? 'Saving…' : 'Set costs'}</BusyButton>}
        </footer>
      </aside>
    </div>
  );
}
