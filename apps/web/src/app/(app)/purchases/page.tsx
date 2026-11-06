'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Combobox from '@/components/Combobox';
import { BusyButton, Empty, SkeletonRows, useConfirm, useToast } from '@/components/Feedback';
import { DueBadge } from '@/components/Badge';
import { StatTiles } from '@/components/StatTiles';
import { Affix, Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { LoadMore, SortTh, usePaged, useSort } from '@/components/Table';
import { api } from '@/lib/api';
import { productOptions, useLookups } from '@/lib/lookups';
import { formatDate, localDay, money, unitLabel } from '@dist/shared';

interface Purchase {
  id: string; purchaseNo: string; date: string; total: string; paidNow: string; status: string;
  supplier: { name: string }; location: { name: string };
}
interface Line { productId: string; unitName: string; qty: string; unitPrice: string }
const emptyLine: Line = { productId: '', unitName: '', qty: '', unitPrice: '' };
const ITEM_COLS = 'minmax(200px, 2.6fr) 120px 90px 140px 110px 36px';

export default function PurchasesPage() {
  const { products, locations, suppliers, error: lookupError } = useLookups();
  const [list, setList] = useState<Purchase[] | null>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const [head, setHead] = useState({ supplierId: '', locationId: '', date: localDay(), paidNow: '', note: '' });
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(0);

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
      setFresh((n) => n + 1);
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
      <FormCard
        key={fresh}
        onSubmit={submit}
        title="New purchase"
        description="Stock goes into the chosen location, the supplier's ledger goes up by the unpaid part, and each product's latest cost is updated."
        actions={
          <FormActions note={lines.some((l) => l.productId) ? `${lines.filter((l) => l.productId).length} item${lines.filter((l) => l.productId).length === 1 ? '' : 's'} · Rs ${money(total)}` : undefined}>
            <BusyButton busy={busy}>{busy ? 'Saving…' : `Save purchase${total ? ` · Rs ${money(total)}` : ''}`}</BusyButton>
          </FormActions>
        }
      >
        <FormSection title="Supplier" description="Who you bought from, where the goods were put, and when.">
          <Field label="Supplier" required span={5} htmlFor="purchase-supplier">
            <Combobox id="purchase-supplier" required options={supplierOpts} value={head.supplierId} recentKey="supplier" placeholder="Search supplier…" onChange={(v) => setHead({ ...head, supplierId: v })} />
          </Field>
          <Field label="Received into" required span={4}>
            <select required value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}>
              <option value="">Select godown or shop…</option>
              {locations.filter((l) => l.type !== 'VEHICLE').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Date" required span={3}>
            <input type="date" required max={localDay()} value={head.date} onChange={(e) => setHead({ ...head, date: e.target.value })} />
          </Field>
        </FormSection>
        <FormSection title="Items" description="Price is per unit as billed by the supplier (per carton, per bag…).">
          <div className="items full" style={{ gridColumn: '1 / -1' }}>
            <div className="items-head" style={{ gridTemplateColumns: ITEM_COLS }}><span>Product</span><span>Unit</span><span className="r">Qty</span><span className="r">Price / unit</span><span className="r">Amount</span><span /></div>
            {lines.map((l, i) => {
              const amount = (Number(l.qty) || 0) * (Number(l.unitPrice) || 0);
              return (
                <div className="items-row" key={i} style={{ gridTemplateColumns: ITEM_COLS }}>
                  <div className="item-product">
                    <Combobox id={`purchase-product-${i}`} ariaLabel="Product" required compact options={productOpts} value={l.productId} recentKey="product" placeholder="Type product name…" onChange={(v) => setLine(i, { productId: v, unitName: prod(v)?.units.find((u) => u.unitName === 'CARTON' || u.unitName === 'BAG')?.unitName ?? prod(v)?.units[0]?.unitName ?? '' })} />
                  </div>
                  <select aria-label="Unit" required disabled={!l.productId} value={l.unitName} onChange={(e) => setLine(i, { unitName: e.target.value })}>
                    {prod(l.productId)?.units.map((u) => <option key={u.unitName} value={u.unitName}>{unitLabel(u.unitName)}{Number(u.factorToBase) !== 1 ? ` (${Number(u.factorToBase)})` : ''}</option>)}
                  </select>
                  <input aria-label="Quantity" className="r" type="number" step="any" min="0" required inputMode="decimal" placeholder="0" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                  <Affix prefix="Rs"><input aria-label="Price per unit" className="r" type="number" step="any" min="0" required inputMode="decimal" placeholder="0" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></Affix>
                  <span className="amt">{amount ? money(amount) : '—'}</span>
                  <button type="button" className="icon-btn" aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="x" /></button>
                </div>
              );
            })}
            <div className="items-foot">
              <button type="button" className="add" onClick={() => setLines([...lines, { ...emptyLine }])}><Icon name="plus" />Add item</button>
              <span className="items-total">Total<b>Rs {money(total)}</b></span>
            </div>
          </div>
        </FormSection>
        <FormSection title="Payment" description="Anything not paid now goes on the supplier's ledger.">
          <Field label="Paid now" optional span={4} hint={total ? `On ledger: Rs ${money(Math.max(0, total - (Number(head.paidNow) || 0)))}` : undefined}>
            <Affix prefix="Rs"><input type="number" step="any" min="0" max={total || undefined} inputMode="decimal" placeholder="0" value={head.paidNow} onChange={(e) => setHead({ ...head, paidNow: e.target.value })} /></Affix>
          </Field>
          <div className="fld span-8" style={{ justifyContent: 'flex-end' }}>
            <div className="chips" style={{ minHeight: 38 }}>
              <button type="button" className="chip" disabled={!total} onClick={() => setHead({ ...head, paidNow: String(total) })}>Paid in full</button>
              <button type="button" className="chip" onClick={() => setHead({ ...head, paidNow: '' })}>Nothing now</button>
            </div>
          </div>
          <Field label="Note" optional span={12}>
            <input value={head.note} placeholder="e.g. supplier bill no., driver name" onChange={(e) => setHead({ ...head, note: e.target.value })} />
          </Field>
        </FormSection>
      </FormCard>
      <div className="section-head"><h2>Purchase history</h2>{list && <span className="count-pill">{list.length}</span>}</div>
      {list && list.length > 0 && (() => {
        const live = list.filter((p) => p.status !== 'CANCELLED');
        const bought = live.reduce((s, p) => s + Number(p.total), 0);
        const paidOut = live.reduce((s, p) => s + Number(p.paidNow), 0);
        const owed = Math.max(0, bought - paidOut);
        return (
          <StatTiles items={[
            { label: 'Bought', value: <><small>Rs</small>{money(bought)}</>, sub: `${live.length} purchase${live.length === 1 ? '' : 's'}`, icon: 'purchases' },
            { label: 'Paid', value: <><small>Rs</small>{money(paidOut)}</>, icon: 'wallet', tone: 'green' },
            { label: 'On supplier ledger', value: <><small>Rs</small>{money(owed)}</>, sub: owed ? 'still to pay suppliers' : 'nothing owed', icon: 'suppliers', tone: owed ? 'amber' : 'green' },
          ]} />
        );
      })()}
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
              <td><span className="bill-no">{p.purchaseNo}</span></td>
              <td className="nowrap">{formatDate(p.date, 'short')}</td>
              <td><b>{p.supplier.name}</b></td>
              <td><span className="badge">{p.location.name}</span></td>
              <td className="num"><strong>{money(p.total)}</strong></td>
              <td className="num">{money(p.paidNow)}</td>
              <td><DueBadge status={p.status} total={p.total} paid={p.paidNow} word="Due" /></td>
              <td>{p.status === 'ACTIVE' && <button className="secondary danger-hover" onClick={() => cancel(p)}>Cancel</button>}</td>
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
