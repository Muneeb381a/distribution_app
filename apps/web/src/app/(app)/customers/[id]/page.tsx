'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Combobox from '@/components/Combobox';
import { BusyButton, Empty, SkeletonRows, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { productOptions, type ProductOpt } from '@/lib/lookups';
import { usePageTitle } from '@/lib/pageTitle';

interface Customer { id: string; name: string; shopName: string | null; phone: string | null; area: string | null; type: string; creditLimit: string | null; openingBalance: string }
interface RateRow { productId: string; unitName: string; rate: string }

export default function CustomerRatesPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const user = useUser();
  const canEdit = can(user, 'RATE_EDIT');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [rows, setRows] = useState<RateRow[] | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  usePageTitle(customer ? `${customer.name} · rates` : null);
  const productOpts = useMemo(() => productOptions(products), [products]);

  useEffect(() => {
    Promise.all([
      api<Customer & { rates: { productId: string; unitName: string; rate: string }[] }>(`/customers/${id}`),
      api<ProductOpt[]>('/products'),
    ])
      .then(([c, p]) => {
        setCustomer(c);
        setProducts(p);
        const r = c.rates.map((x) => ({ productId: x.productId, unitName: x.unitName, rate: String(Number(x.rate)) }));
        setRows(r);
        setSaved(JSON.stringify(r));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const update = (i: number, patch: Partial<RateRow>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dirty = rows !== null && JSON.stringify(rows) !== saved;
  const unitsOf = (productId: string) => products.find((p) => p.id === productId)?.units ?? [];

  async function save() {
    if (!rows) return;
    setBusy(true);
    try {
      const clean = rows.filter((r) => r.productId && r.rate !== '');
      await api(`/customers/${id}/rates`, { method: 'PUT', json: { rates: clean.map((r) => ({ ...r, rate: Number(r.rate) })) } });
      setRows(clean);
      setSaved(JSON.stringify(clean));
      toast.success(`Rates saved for ${customer?.name}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !customer) return <><Link className="back" href="/customers"><Icon name="chevronLeft" />Customers</Link><p className="error">{error}</p></>;

  return (
    <>
      <Link className="back" href="/customers"><Icon name="chevronLeft" />Customers</Link>
      <section className="card">
        {!customer ? <span className="skeleton" style={{ display: 'block', height: 60 }} /> : (
          <div className="party">
            <div className="avatar">{customer.name.slice(0, 2)}</div>
            <div className="party-who">
              <h1>{customer.name}</h1>
              <p>
                {customer.shopName && <span>{customer.shopName}</span>}
                {customer.area && <span>{customer.area}</span>}
                {customer.phone && <a href={`tel:${customer.phone}`}>{customer.phone}</a>}
                <span className={`badge ${customer.type === 'CREDIT' ? 'amber' : 'green'}`}>{customer.type === 'CREDIT' ? 'Udhaar' : 'Cash'}</span>
              </p>
            </div>
            <div className="actions">
              <Link className="btn" href={`/khata/${customer.id}`}><Icon name="khata" />Khata</Link>
              {can(user, 'SALE_CREATE') && <Link className="btn primary" href={`/sales/new?customer=${customer.id}`}><Icon name="plus" />New bill</Link>}
            </div>
          </div>
        )}
      </section>

      <div className="mini-stats">
        <div className="stat"><span className="label">Fixed rates</span><span className="value">{rows?.length ?? '—'}</span><span className="sub">product / unit pairs</span></div>
        <div className="stat"><span className="label">Credit limit</span><span className="value">{customer?.creditLimit ? <><small>Rs</small>{Number(customer.creditLimit).toLocaleString('en-PK')}</> : '—'}</span></div>
        <div className="stat"><span className="label">Opening balance</span><span className="value"><small>Rs</small>{Number(customer?.openingBalance ?? 0).toLocaleString('en-PK')}</span></div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Customer rates</h2>
          {dirty && <span className="badge amber">Unsaved changes</span>}
        </div>
        <p className="card-sub">Fixed rate per product and unit. It pre-fills on this customer&apos;s bills; users with the rate-edit permission can still change it on a bill.</p>
        <div className="table-wrap">
          <table className="rates">
            <thead><tr><th>Product</th><th>Unit</th><th className="num">Rate (Rs)</th>{canEdit && <th><span className="sr-only">Remove</span></th>}</tr></thead>
            <tbody>
              {!rows && <SkeletonRows cols={canEdit ? 4 : 3} rows={3} />}
              {rows?.map((r, i) => (
                <tr key={i}>
                  <td style={{ minWidth: 220 }}>
                    <Combobox ariaLabel="Product" compact disabled={!canEdit} options={productOpts} value={r.productId} recentKey="product" placeholder="Type product name…"
                      onChange={(v) => update(i, { productId: v, unitName: unitsOf(v)[0]?.unitName ?? '' })} />
                  </td>
                  <td>
                    <select aria-label="Unit" disabled={!canEdit || !r.productId} value={r.unitName} onChange={(e) => update(i, { unitName: e.target.value })}>
                      {unitsOf(r.productId).map((u) => <option key={u.unitName} value={u.unitName}>{u.unitName.toLowerCase()}</option>)}
                    </select>
                  </td>
                  <td className="num"><input aria-label="Rate" className="num-input" type="number" step="any" min="0" inputMode="decimal" disabled={!canEdit} value={r.rate} onChange={(e) => update(i, { rate: e.target.value })} /></td>
                  {canEdit && <td><button type="button" className="secondary icon-only danger-hover" aria-label="Remove rate" title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="x" /></button></td>}
                </tr>
              ))}
              {rows && !rows.length && (
                <tr><td colSpan={4}><Empty icon="expenses" title="No fixed rates yet" text="The product's normal price is used on bills." action={canEdit && <button type="button" onClick={() => setRows([{ productId: '', unitName: '', rate: '' }])}><Icon name="plus" />Add first rate</button>} /></td></tr>
              )}
            </tbody>
          </table>
        </div>
        {canEdit && rows && (
          <div className="actions" style={{ marginTop: 4 }}>
            {rows.length > 0 && <button type="button" className="secondary btn-icon" onClick={() => setRows([...rows, { productId: '', unitName: '', rate: '' }])}><Icon name="plus" />Add rate</button>}
            <BusyButton busy={busy} disabled={!dirty} onClick={save}>Save rates</BusyButton>
          </div>
        )}
      </section>
    </>
  );
}
