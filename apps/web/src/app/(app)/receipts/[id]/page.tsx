'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ReceiptA4 } from '@/components/BillA4';
import PrintPanel from '@/components/PrintPanel';
import { api } from '@/lib/api';
import { urdu } from '@/lib/fonts';
import { renderReceiptImage, type ReceiptData } from '@/lib/saleImage';

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [receipt, setReceipt] = useState<(ReceiptData & { customerId: string }) | null>(null);
  const [image, setImage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<NonNullable<typeof receipt>>(`/payments/${id}`)
      .then(async (r) => {
        setReceipt(r);
        setImage(await renderReceiptImage(r, urdu.style.fontFamily));
      })
      .catch((e) => setError(e.message));
  }, [id]);

  return (
    <>
      <div className="no-print">
        {receipt && <p><Link href={`/khata/${receipt.customerId}`}>← {receipt.customer.name}&apos;s khata</Link></p>}
        <h1>Receipt {receipt?.receiptNo}</h1>
        {error && <p className="error">{error}</p>}
      </div>
      {receipt && <PrintPanel thermalImage={image} a4={<ReceiptA4 r={receipt} />} />}
    </>
  );
}
