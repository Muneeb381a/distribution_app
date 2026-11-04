'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ReceiptA4 } from '@/components/BillA4';
import { BusyButton, useConfirm, useToast } from '@/components/Feedback';
import { Icon } from '@/components/Icon';
import PrintPanel, { usePrintMode } from '@/components/PrintPanel';
import { api, can, useUser } from '@/lib/api';
import { urdu } from '@/lib/fonts';
import { usePageTitle } from '@/lib/pageTitle';
import { renderReceiptImage, type ReceiptData } from '@/lib/saleImage';
import { money } from '@dist/shared';

type Receipt = ReceiptData & { id: string; customerId: string; saleId: string | null; sale: { billNo: string } | null; customer: ReceiptData['customer'] & { phone: string | null } };


export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const toast = useToast();
  const confirm = useConfirm();
  const { mode, setMode, print } = usePrintMode();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [image, setImage] = useState('');
  const [imageError, setImageError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  usePageTitle(receipt ? `Receipt ${receipt.receiptNo}` : null);

  const load = useCallback(() => api<Receipt>(`/payments/${id}`)
    .then((r) => {
      setReceipt(r);
      renderReceiptImage(r, urdu.style.fontFamily).then(setImage).catch((e) => setImageError((e as Error).message));
    })
    .catch((e) => setError(e.message)), [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancel() {
    if (!receipt) return;
    if (!(await confirm({ title: `Cancel receipt ${receipt.receiptNo}?`, body: <p>Rs {money(receipt.amount)} is added back to {receipt.customer.name}&apos;s khata.</p>, confirmLabel: 'Cancel receipt', cancelLabel: 'Keep', danger: true }))) return;
    setBusy(true);
    try {
      await api(`/payments/${id}/cancel`, { method: 'POST', json: {} });
      toast.success(`Receipt ${receipt.receiptNo} cancelled`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!receipt) {
    return error ? <p className="error">{error}</p> : <span className="skeleton" style={{ display: 'block', height: 240 }} aria-busy="true" />;
  }
  const cancelled = receipt.status === 'CANCELLED';

  return (
    <>
      <div className="no-print">
        <Link className="back" href={`/khata/${receipt.customerId}`}><Icon name="chevronLeft" />{receipt.customer.name}&apos;s khata</Link>
        <div className="doc-head">
          <div>
            <h1>Receipt {receipt.receiptNo} <span className={`badge ${cancelled ? 'red' : 'green'}`}>{cancelled ? 'Cancelled' : 'Received'}</span></h1>
            <p>{new Date(receipt.createdAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{receipt.recordedBy && ` · by ${receipt.recordedBy}`}</p>
          </div>
          <div className="actions" role="toolbar" aria-label="Receipt actions">
            <button onClick={() => print()}><Icon name="print" />Print</button>
            {!cancelled && !receipt.saleId && can(user, 'SALE_CANCEL') && (
              <BusyButton className="danger-ghost" busy={busy} onClick={cancel}>{!busy && <Icon name="ban" />}Cancel receipt</BusyButton>
            )}
          </div>
        </div>
        {cancelled && <div className="cancelled-banner" role="alert"><Icon name="ban" />This receipt was cancelled; the amount was added back to the khata.</div>}
        <div className="mini-stats">
          <div className="stat"><span className="label">Received</span><span className="value">Rs {money(receipt.amount)}</span><span className="sub">{receipt.method.toLowerCase()}</span></div>
          <div className="stat"><span className="label">Balance before</span><span className="value">{money(receipt.previousBalance)}</span></div>
          <div className="stat"><span className="label">Balance after</span><span className={`value${Number(receipt.newBalance) > 0 ? ' neg' : ''}`}>{money(receipt.newBalance)}</span>{receipt.sale && <span className="sub">With bill <Link href={`/sales/${receipt.saleId}`}>{receipt.sale.billNo}</Link></span>}</div>
        </div>
      </div>
      <PrintPanel thermalImage={image} thermalError={imageError} a4={<ReceiptA4 r={receipt} />} mode={mode} setMode={setMode} print={print} />
    </>
  );
}
