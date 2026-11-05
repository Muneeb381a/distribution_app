'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DeliveryPanel, type DeliveryState } from '@/components/DeliveryPanel';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { usePageTitle } from '@/lib/pageTitle';
import { useSettings } from '@/lib/settings';
import { contactLine, formatDate, unitLabel } from '@dist/shared';

interface Slip extends DeliveryState {
  billNo: string; date: string; saleType: string; note: string | null;
  customer: { id: string; name: string; shopName: string | null; phone: string | null; area: string | null } | null;
  salesman: { name: string } | null;
  location: { name: string };
  vehicle: { name: string } | null;
  items: { product: { name: string; size: string | null }; unitName: string; qty: string }[];
  empties: { productName: string; given: number; collected: number }[] | null;
}

/**
 * The delivery slip: what is on the vehicle for this customer, with no rates, and a line for the person
 * at the other end to sign. Print it (or send it with the driver), then mark it delivered with the name signed.
 */
export default function DeliverySlipPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const biz = useSettings();
  const [s, setS] = useState<Slip | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => api<Slip>(`/sales/${id}`).then((r) => {
    setS(r);
    if (r.customer) api<{ address: string | null }>(`/customers/${r.customer.id}`).then((c) => setAddress(c.address)).catch(() => {});
  }).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  usePageTitle(s ? `Delivery slip · ${s.billNo}` : null);

  if (error) return <><Link className="back" href="/sales"><Icon name="chevronLeft" />Sales</Link><p className="error">{error}</p></>;
  if (!s) return <span className="skeleton" style={{ display: 'block', height: 320 }} />;
  const empties = (s.empties ?? []).filter((e) => e.given || e.collected);

  return (
    <>
      <Link className="back no-print" href={`/sales/${id}`}><Icon name="chevronLeft" />Bill {s.billNo}</Link>
      <div className="doc-grid">
        <article className="slip card paper">
          <header className="slip-head">
            <div>
              <span className="slip-biz">{biz.businessName}{contactLine(biz) ? ` · ${contactLine(biz)}` : ''}</span>
              <span className="slip-kicker">Delivery slip</span>
              <h1>{s.billNo}</h1>
            </div>
            <div className="actions no-print">
              <button onClick={() => window.print()}><Icon name="print" />Print</button>
            </div>
          </header>
          <dl className="meta slip-meta">
            <div><dt>Deliver to</dt><dd>{s.customer ? <>{s.customer.name}{s.customer.shopName ? ` · ${s.customer.shopName}` : ''}</> : 'Walk-in'}</dd></div>
            {(address || s.customer?.area) && <div><dt>Address</dt><dd>{[address, s.customer?.area].filter(Boolean).join(', ')}</dd></div>}
            {s.customer?.phone && <div><dt>Phone</dt><dd>{s.customer.phone}</dd></div>}
            <div><dt>Date</dt><dd>{formatDate(s.date)}</dd></div>
            <div><dt>Vehicle</dt><dd>{s.vehicle?.name ?? s.location.name}</dd></div>
            {s.salesman && <div><dt>Driver / salesman</dt><dd>{s.salesman.name}</dd></div>}
            <div><dt>From</dt><dd>{s.location.name}</dd></div>
          </dl>
          <table className="slip-table">
            <thead><tr><th>Item</th><th className="num">Quantity</th></tr></thead>
            <tbody>
              {s.items.map((i, k) => (
                <tr key={k}><td>{i.product.size ? `${i.product.name} (${i.product.size})` : i.product.name}</td><td className="num">{Number(i.qty)} {unitLabel(i.unitName)}</td></tr>
              ))}
            </tbody>
          </table>
          {empties.length > 0 && (
            <p style={{ margin: '12px 0 0' }}>
              <b>Empties:</b> {empties.map((e) => `${e.productName}: given ${e.given}, collected ${e.collected}`).join(' · ')}
            </p>
          )}
          {s.note && <p className="muted" style={{ margin: '8px 0 0' }}>Note: {s.note}</p>}
          <p style={{ margin: '18px 0 0' }}>I have received the goods listed above in good condition.</p>
          <footer className="slip-sign">
            <span>{s.deliveryStatus === 'DELIVERED' && s.receivedBy ? `Received by ${s.receivedBy}` : 'Received by (name & signature)'}</span>
            <span>Date &amp; stamp</span>
          </footer>
        </article>
        <aside className="doc-side no-print">
          <DeliveryPanel sale={s} canMark={can(user, 'SALE_CREATE')} onDone={load} />
          {!s.deliveryStatus && <section className="card"><p className="muted" style={{ margin: 0 }}>This bill came from a loaded vehicle, so it is not tracked as a pending delivery. You can still print and sign the slip.</p></section>}
        </aside>
      </div>
    </>
  );
}
