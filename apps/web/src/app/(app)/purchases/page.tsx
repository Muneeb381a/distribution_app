'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Combobox from '@/components/Combobox';
import { BusyButton, Empty, SkeletonRows, useConfirm, useToast } from '@/components/Feedback';
import { DueBadge } from '@/components/Badge';
import { Icon } from '@/components/Icon';
import { LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api } from '@/lib/api';
import { productOptions, useLookups } from '@/lib/lookups';
import { localDay, money } from '@dist/shared';

interface Purchase {
  id: string; purchaseNo: string; date: string; total: string; paidNow: string; status: string;
  supplier: { name: string }; location: { name: string };
}
interface Line { productId: string; unitName: string; qty: string; unitPrice: string }
const emptyLine: Line = { productId: '', unitName: '', qty: '', unitPrice: '' };

export default function PurchasesPage() {
  const { products, locations, suppliers, error: lookupError } = useLookups();
  const [list, setList] = useState<Purchase[] | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const [head, setHead] = useState({ supplierId: '', locationId: '', date: localDay(), paidNow: '', note: '' });
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Purchase[]>('/purchases').then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => {
     
    load();
  }, [load]);

  const productOpts = useMemo(() => productOptions(products), [products]);
  const supplierOpts = useMemo(() => suppliers.map((s) => ({ value: s.id, label: s.name })), [suppliers]);
  type Key = 'no' | 'date' | 'supplier' | 'total' | 'paid';
  const { sorted, sort, toggle } = useSort<Purchase, Key>(list ?? [], (p, k) =>
    k === 'no' ? p.purchaseNo : k === 'date' ? p.date : k === 'supplier' ? p.supplier.name : k === 'total' ? p.total : p.paidNow);
  const { page, loadMore } = usePaged(sorted);
  const prod = (id: string) => products.find((p) => p.id === id);
  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/purchases', {
        method: 'POST',
        json: {
          supplierId: head.supplierId,
          locationId: head.locationId,
          date: head.date,
          paidNow: head.paidNow ? Number(head.paidNow) : undefined,
          note: head.note || undefined,
          items: lines.map((l) => ({ productId: l.productId, unitName: l.unitName, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
        },
      });
      setLines([{ ...emptyLine }]);
      setHead({ ...head, paidNow: '', note: '' });
      toast.success(`Purchase of Rs ${money(total)} saved`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(p: Purchase) {
    if (!(await confirm({ title: `Cancel ${p.purchaseNo}?`, body: <p>Stock and the {p.supplier.name} balance will be reversed.</p>, confirmLabel: 'Cancel purchase', cancelLabel: 'Keep', danger: true }))) return;
    try {
      await api(`/purchases/${p.id}/cancel`, { method: 'POST', json: {} });
      toast.success(`${p.purchaseNo} cancelled`);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <div className="page-head"><div><h1>Purchases</h1><p>Record stock bought from suppliers</p></div></div>
      {(error || lookupError) && <p className="error">{error || lookupError}</p>}
      <form className="card" onSubmit={submit}>
        <h3>New purchase</h3>
        <div className="form">
          <div className="field">
            <label htmlFor="purchase-supplier">Supplier</label>
            <Combobox id="purchase-supplier" required options={supplierOpts} value={head.supplierId} recentKey="supplier" placeholder="Search supplier…" onChange={(v) => setHead({ ...head, supplierId: v })} />
          </div>
          <label>Received into
            <select required value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}>
              <option value="">—</option>
              {locations.filter((l) => l.type !== 'VEHICLE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label>Date<input type="date" required value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} /></label>
        </div>
        {lines.map((l, i) => (
          <div className="form" key={i} style={{ marginTop: 14, paddingTop: 14, borderTop: '1px dashed var(--border)' }}>
            <div className="field">
              <label htmlFor={`purchase-product-${i}`}>Product</label>
              <Combobox id={`purchase-product-${i}`} required compact options={productOpts} value={l.productId} recentKey="product" placeholder="Type product name…" onChange={(v) => setLine(i, { productId: v, unitName: prod(v)?.units[0]?.unitName ?? '' })} />
            </div>
            <label>Unit
              <select required value={l.unitName} onChange={(e) => setLine(i, { unitName: e.target.value })}>
                {prod(l.productId)?.units.map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName}</option>)}
              </select>
            </label>
            <label>Qty<input type="number" step="any" min="0" required value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></label>
            <label>Price per unit<input type="number" step="any" min="0" required value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></label>
            <span className="badge" style={{ alignSelf: 'center' }}>= Rs {money((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}</span>
            {lines.length > 1 && <button type="button" className="secondary" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>}
          </div>
        ))}
        <div className="form" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button type="button" className="secondary" onClick={() => setLines([...lines, { ...emptyLine }])}>+ Add item</button>
          <label>Paid now<input type="number" step="any" min="0" max={total} value={head.paidNow} onChange={(e) => setHead({ ...head, paidNow: e.target.value })} /></label>
          <label>Note<input value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} /></label>
          <strong style={{ fontSize: 18 }}>Total Rs {money(total)}</strong>
          <BusyButton busy={busy}>{busy ? 'Saving…' : 'Save purchase'}</BusyButton>
        </div>
      </form>
      <h2>Purchase history</h2>
      <table className="sticky-head">
        <thead>
          <tr>
            <SortTh k="no" sort={sort} toggle={toggle}>No.</SortTh>
            <SortTh k="date" sort={sort} toggle={toggle}>Date</SortTh>
            <SortTh k="supplier" sort={sort} toggle={toggle}>Supplier</SortTh>
            <th>Into</th>
            <SortTh k="total" sort={sort} toggle={toggle} num>Total</SortTh>
            <SortTh k="paid" sort={sort} toggle={toggle} num>Paid</SortTh>
            <th>Status</th><th />
          </tr>
        </thead>
        <tbody>
          {!list && <SkeletonRows cols={8} />}
          {page.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.purchaseNo}</strong></td>
              <td>{p.date.slice(0, 10)}</td>
              <td>{p.supplier.name}</td>
              <td>{p.location.name}</td>
              <td className="num"><strong>{money(p.total)}</strong></td>
              <td className="num">{money(p.paidNow)}</td>
              <td><DueBadge status={p.status} total={p.total} paid={p.paidNow} word="Due" /></td>
              <td>{p.status === 'ACTIVE' && <button className="secondary" onClick={() => cancel(p)}>Cancel</button>}</td>
            </tr>
          ))}
          {list && !list.length && (
            <tr><td colSpan={8}><Empty icon="purchases" title="No purchases yet" text="Record the first stock you bought using the form above." action={<button type="button" onClick={() => document.getElementById('purchase-supplier')?.focus()}><Icon name="plus" /> Add first purchase</button>} /></td></tr>
          )}
        </tbody>
      </table>
      <LoadMore shown={page.length} total={sorted.length} onMore={loadMore} />
      <p className="muted" style={{ fontSize: 13 }}>Supplier balances and returns are on each <Link href="/suppliers">supplier&apos;s ledger</Link>.</p>
    </>
  );
}
