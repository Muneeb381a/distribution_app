'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BillA4 } from '@/components/BillA4';
import { BusyButton, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import PrintPanel, { usePrintMode } from '@/components/PrintPanel';
import { api, can, useUser } from '@/lib/api';
import { urdu } from '@/lib/fonts';
import { usePageTitle } from '@/lib/pageTitle';
import { renderBillImage, type BillData } from '@/lib/saleImage';
import { useSettings } from '@/lib/settings';
import { money, unitLabel, waPhone } from '@dist/shared';

type Bill = BillData & {
  id: string;
  customerId: string | null;
  customer: (BillData['customer'] & { id: string; phone: string | null; area: string | null; type: string }) | null;
  location: { name: string; type: string };
  payments: { id: string; receiptNo: string; amount: string; method: string; status: string }[];
};

const label = (p: { name: string; size: string | null }) => (p.size ? `${p.name} (${p.size})` : p.name);

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const { mode, setMode, print } = usePrintMode(search.get('print') === 'a4' ? 'a4' : 'thermal');
  const [bill, setBill] = useState<Bill | null>(null);
  const [image, setImage] = useState('');
  const [imageError, setImageError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const autoPrinted = useRef(false);

  usePageTitle(bill ? `Bill ${bill.billNo}` : null);

  const load = useCallback(async () => {
    try {
      const b = await api<Bill>(`/sales/${id}`);
      setBill(b);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // The bill shows even if the thermal picture cannot be drawn (e.g. font still loading).
  const settings = useSettings();
  useEffect(() => {
    if (!bill) return;
    renderBillImage(bill, urdu.style.fontFamily, settings).then((img) => { setImage(img); setImageError(''); }).catch((e) => setImageError((e as Error).message));
  }, [bill, settings]);

  // /sales/:id?print=thermal|a4 opens the print dialog once the preview is ready (used by the "Save & print" flow).
  useEffect(() => {
    const want = search.get('print');
    if (!want || autoPrinted.current || !bill) return;
    if (want === 'thermal' && !image) return;
    autoPrinted.current = true;
    print(want === 'a4' ? 'a4' : 'thermal');
  }, [search, bill, image, print]);

  async function cancel() {
    if (!bill) return;
    const ok = await confirm({
      title: `Cancel bill ${bill.billNo}?`,
      body: <p>Stock goes back, the customer balance is reversed and its receipts are cancelled. This cannot be undone.</p>,
      confirmLabel: 'Cancel bill',
      cancelLabel: 'Keep bill',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/sales/${id}/cancel`, { method: 'POST', json: {} });
      toast.success(`Bill ${bill.billNo} cancelled`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!bill) return;
    const text = [
      `Bill ${bill.billNo} · ${new Date(bill.createdAt).toLocaleDateString('en-GB')}`,
      bill.customer ? `${bill.customer.name}${bill.customer.shopName ? ` (${bill.customer.shopName})` : ''}` : 'Cash sale',
      ...bill.items.map((l) => `${label(l.product)} ${Number(l.qty)} ${unitLabel(l.unitName)} × ${money(l.rate)} = ${money(l.lineTotal)}`),
      `Total: Rs ${money(bill.net)}`,
      `Paid: Rs ${money(bill.paidNow)}`,
      ...(bill.customer ? [`Balance: Rs ${money(bill.newBalance)}`] : []),
    ].join('\n');
    try {
      if (image && navigator.canShare) {
        const file = new File([await (await fetch(image)).blob()], `${bill.billNo}.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `Bill ${bill.billNo}`, text });
          return;
        }
      }
      if (navigator.share) {
        await navigator.share({ title: `Bill ${bill.billNo}`, text });
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    window.open(`https://wa.me/${waPhone(bill.customer?.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  if (error && !bill) {
    return (
      <>
        <Link className="back" href="/sales"><Icon name="chevronLeft" />Sales</Link>
        <p className="error">{error}</p>
      </>
    );
  }

  if (!bill) {
    return (
      <div aria-busy="true">
        <span className="skeleton" style={{ display: 'block', width: 260, height: 32, marginBottom: 20 }} />
        <div className="doc-grid">
          <span className="skeleton" style={{ display: 'block', height: 320 }} />
          <span className="skeleton" style={{ display: 'block', height: 320 }} />
        </div>
      </div>
    );
  }

  const cancelled = bill.status === 'CANCELLED';
  const due = Math.max(0, Number(bill.net) - Number(bill.paidNow));
  const empties = bill.empties?.filter((e) => e.given || e.collected) ?? [];

  return (
    <>
      <div className="no-print">
        <Link className="back" href="/sales"><Icon name="chevronLeft" />Sales</Link>
        <div className="doc-head">
          <div>
            <h1>
              Bill {bill.billNo}
              <span className={`badge ${cancelled ? 'red' : 'green'}`}>{cancelled ? 'Cancelled' : 'Active'}</span>
              <span className="badge blue">{bill.saleType === 'DELIVERY' ? 'Delivery' : 'Counter'}</span>
            </h1>
            <p>{new Date(bill.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · {bill.location.name}</p>
          </div>
          <div className="actions" role="toolbar" aria-label="Bill actions">
            <button onClick={() => print()}><Icon name="print" />Print</button>
            <button className="secondary" onClick={share}><Icon name="share" />Share</button>
            {!cancelled && can(user, 'SALE_CANCEL') && (
              <BusyButton className="danger-ghost" busy={busy} onClick={cancel}>{!busy && <Icon name="ban" />}Cancel bill</BusyButton>
            )}
            <Link className="btn" href="/sales/new"><Icon name="plus" />New bill</Link>
          </div>
        </div>

        {cancelled && <div className="cancelled-banner" role="alert"><Icon name="ban" />This bill was cancelled. Stock and the customer balance were reversed.</div>}

        <div className="doc-grid">
          <div>
            <section className="card">
              <dl className="meta">
                <div>
                  <dt>Customer</dt>
                  <dd>
                    {bill.customer ? <Link href={`/khata/${bill.customer.id}`}>{bill.customer.name}</Link> : 'Walk-in (cash)'}
                    {bill.customer?.type === 'CREDIT' && <> <span className="badge amber">Udhaar</span></>}
                  </dd>
                </div>
                {bill.customer?.shopName && <div><dt>Shop</dt><dd>{bill.customer.shopName}</dd></div>}
                {bill.customer?.phone && <div><dt>Phone</dt><dd><a href={`tel:${bill.customer.phone}`}>{bill.customer.phone}</a></dd></div>}
                {bill.customer?.area && <div><dt>Area</dt><dd>{bill.customer.area}</dd></div>}
                <div><dt>Salesman</dt><dd>{bill.salesman?.name ?? '—'}</dd></div>
              </dl>
            </section>

            <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrap">
                <table style={{ margin: 0, border: 0, borderRadius: 0 }}>
                  <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {bill.items.map((l, i) => (
                      <tr key={i}>
                        <td><b>{label(l.product)}</b></td>
                        <td className="num">{Number(l.qty)} {unitLabel(l.unitName)}</td>
                        <td className="num">{money(l.rate)}</td>
                        <td className="num"><b>{money(l.lineTotal)}</b></td>
                      </tr>
                    ))}
                    {bill.returns.map((r, i) => (
                      <tr key={`r${i}`}>
                        <td>Return · {label(r.product)} <span className="badge red">{r.reason.toLowerCase()}</span></td>
                        <td className="num">{Number(r.qty)} {unitLabel(r.unitName)}</td>
                        <td className="num muted">—</td>
                        <td className="num amt-credit">-{money(r.creditAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {empties.length > 0 && (
              <section className="card">
                <h3>Empties</h3>
                <div className="pills" style={{ marginTop: 0 }}>
                  {empties.map((e) => <span className="badge" key={e.productName}>{e.productName}: gave {e.given}, took {e.collected}, shop holds {e.heldAfter}</span>)}
                </div>
              </section>
            )}
          </div>

          <aside className="doc-side">
            <section className="card receipt">
              <h2>Totals</h2>
              <dl className="totals">
                <dt>Items</dt><dd>{money(bill.gross)}</dd>
                {Number(bill.returnsCredit) > 0 && <><dt>Returns credit</dt><dd className="good">-{money(bill.returnsCredit)}</dd></>}
                <dt className="grand-row">This bill</dt><dd className="grand-row">Rs {money(bill.net)}</dd>
                <dt>Paid now</dt><dd className="good">{money(bill.paidNow)}</dd>
                {bill.customer && <><dt>Udhaar on this bill</dt><dd className={due > 0 ? 'neg' : ''}>{money(due)}</dd></>}
              </dl>
              {bill.customer && (
                <dl className="totals after">
                  <dt>Previous balance</dt><dd>{money(bill.previousBalance)}</dd>
                  <dt><b>New balance</b></dt><dd><b>{money(bill.newBalance)}</b></dd>
                  {bill.availableCredit != null && <><dt className="muted">Credit available</dt><dd className={Number(bill.availableCredit) < 0 ? 'neg' : 'muted'}>{money(bill.availableCredit)}</dd></>}
                </dl>
              )}
            </section>
            {bill.payments.length > 0 && (
              <section className="card">
                <h3>Receipts</h3>
                <ul className="list">
                  {bill.payments.map((p) => (
                    <li key={p.id}>
                      <span className="who-line"><b><Link href={`/receipts/${p.id}`}>{p.receiptNo}</Link></b><span>{p.method.toLowerCase()}</span></span>
                      <span className="amt">{p.status === 'CANCELLED' ? <span className="badge red">Cancelled</span> : money(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
        <h2>Print preview</h2>
      </div>

      <PrintPanel thermalImage={image} thermalError={imageError} a4={<BillA4 b={bill} />} mode={mode} setMode={setMode} print={print} />
    </>
  );
}
