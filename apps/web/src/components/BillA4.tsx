'use client';

import { urdu } from '@/lib/fonts';
import type { BillData, ReceiptData } from '@/lib/saleImage';
import { useSettings } from '@/lib/settings';
import { contactLine, money, unitLabel } from '@dist/shared';

const name = (p: { name: string; size: string | null }) => (p.size ? `${p.name} (${p.size})` : p.name);

function Row({ en, ur, value, bold }: { en: string; ur: string; value: string; bold?: boolean }) {
  return (
    <tr style={bold ? { fontWeight: 700 } : undefined}>
      <td>{en}</td>
      <td className={urdu.className} dir="rtl" style={{ textAlign: 'center' }}>{ur}</td>
      <td style={{ textAlign: 'right' }}>{value}</td>
    </tr>
  );
}

/** Business name and contact from Settings, then the document number and time. */
function Head({ title, no, when, cancelled }: { title: string; no: string; when: string; cancelled: boolean }) {
  const s = useSettings();
  const contact = contactLine(s);
  return (
    <>
      {s.urduName && <h1 className={urdu.className} dir="rtl" style={{ textAlign: 'center', margin: 0 }}>{s.urduName}</h1>}
      <p className="a4-biz">
        <strong>{s.businessName}</strong>{s.tagline && <> · {s.tagline}</>}
        {(contact || s.ntn) && <><br /><span className="muted">{[contact, s.ntn && `NTN ${s.ntn}`].filter(Boolean).join(' · ')}</span></>}
      </p>
      <p style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>{title} {no}</strong>
        <span>{new Date(when).toLocaleString('en-GB')}</span>
      </p>
      {cancelled && <p className="error"><strong>CANCELLED</strong></p>}
    </>
  );
}

function Foot() {
  const s = useSettings();
  if (!s.footer && !s.note) return null;
  return (
    <div className="a4-foot">
      {s.footer && <p className={urdu.className} dir="rtl">{s.footer}</p>}
      {s.note && <p className="muted">{s.note}</p>}
    </div>
  );
}

export function BillA4({ b }: { b: BillData }) {
  return (
    <div className="a4-bill">
      <Head title="Bill" no={b.billNo} when={b.createdAt} cancelled={b.status === 'CANCELLED'} />
      <p>
        <strong>{b.customer?.name ?? 'Cash sale'}</strong>
        {b.customer?.shopName && <> · {b.customer.shopName}</>}
        {b.salesman && <> · Salesman: {b.salesman.name}</>}
      </p>
      <table>
        <thead><tr><th>Item</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
        <tbody>
          {b.items.map((l, i) => (
            <tr key={i}>
              <td>{name(l.product)}</td>
              <td style={{ textAlign: 'right' }}>{Number(l.qty)} {unitLabel(l.unitName)}</td>
              <td style={{ textAlign: 'right' }}>{money(l.rate)}</td>
              <td style={{ textAlign: 'right' }}>{money(l.lineTotal)}</td>
            </tr>
          ))}
          {b.returns.map((r, i) => (
            <tr key={`r${i}`}>
              <td>Return: {name(r.product)} ({r.reason.toLowerCase()})</td>
              <td style={{ textAlign: 'right' }}>{Number(r.qty)} {unitLabel(r.unitName)}</td>
              <td />
              <td style={{ textAlign: 'right' }}>-{money(r.creditAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: 16, maxWidth: 420, marginLeft: 'auto' }}>
        <tbody>
          {b.customer && <Row en="Previous balance" ur="پچھلا بقایا" value={money(b.previousBalance)} />}
          <Row en="This bill" ur="یہ بل" value={money(b.net)} />
          {Number(b.paidNow) > 0 && <Row en="Paid now" ur="ادا شدہ" value={`-${money(b.paidNow)}`} />}
          {b.customer && <Row en="New balance" ur="کل بقایا" value={money(b.newBalance)} bold />}
        </tbody>
      </table>
      {b.customer?.creditLimit && (
        <p className="muted">Credit limit {money(b.customer.creditLimit)} · available {money(b.availableCredit ?? 0)}</p>
      )}
      {b.empties?.map((e) => (
        <p key={e.productName} className="muted">Empties {e.productName}: given {e.given}, collected {e.collected}, held {e.heldAfter}</p>
      ))}
      <Foot />
    </div>
  );
}

export function ReceiptA4({ r }: { r: ReceiptData }) {
  return (
    <div className="a4-bill">
      <Head title="Receipt" no={r.receiptNo} when={r.createdAt} cancelled={r.status === 'CANCELLED'} />
      <p><strong>{r.customer.name}</strong>{r.customer.shopName && <> · {r.customer.shopName}</>}</p>
      <table style={{ maxWidth: 420 }}>
        <tbody>
          <Row en="Previous balance" ur="پچھلا بقایا" value={money(r.previousBalance)} />
          <Row en={`Received (${r.method.toLowerCase()})`} ur="وصول" value={`-${money(r.amount)}`} bold />
          <Row en="New balance" ur="کل بقایا" value={money(r.newBalance)} bold />
        </tbody>
      </table>
      {r.recordedBy && <p className="muted">Received by {r.recordedBy}</p>}
      <Foot />
    </div>
  );
}
