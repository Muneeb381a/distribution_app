'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BillA4 } from '@/components/BillA4';
import PrintPanel from '@/components/PrintPanel';
import { api, can, useUser } from '@/lib/api';
import { urdu } from '@/lib/fonts';
import { renderBillImage, type BillData } from '@/lib/saleImage';

export default function BillPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const [bill, setBill] = useState<(BillData & { id: string; payments: { id: string; receiptNo: string }[] }) | null>(null);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const b = await api<NonNullable<typeof bill>>(`/sales/${id}`);
      setBill(b);
      setImage(await renderBillImage(b, urdu.style.fontFamily));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function cancel() {
    if (!confirm('Cancel this bill? Stock, the customer balance and its receipts are reversed.')) return;
    setError('');
    try {
      await api(`/sales/${id}/cancel`, { method: 'POST', json: {} });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <div className="no-print">
        <p><Link href="/sales">← Sales</Link></p>
        <h1>Bill {bill?.billNo}</h1>
        {error && <p className="error">{error}</p>}
        {bill?.status === 'ACTIVE' && can(user, 'SALE_CANCEL') && (
          <p><button className="secondary" onClick={cancel}>Cancel bill</button></p>
        )}
      </div>
      {bill && <PrintPanel thermalImage={image} a4={<BillA4 b={bill} />} />}
    </>
  );
}
