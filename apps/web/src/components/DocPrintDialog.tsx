'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BillA4, ReceiptA4 } from '@/components/BillA4';
import { Icon } from '@/components/Icon';
import PrintPanel, { usePrintMode, type PrintMode } from '@/components/PrintPanel';
import { urdu } from '@/lib/fonts';
import { renderBillImage, renderReceiptImage, type BillData, type ReceiptData } from '@/lib/saleImage';
import { useSettings } from '@/lib/settings';

/**
 * Print a bill or receipt that only exists on this PC (saved offline). Works with no server:
 * the thermal image is drawn in the browser and the A4 version is plain HTML.
 */
export default function DocPrintDialog({ bill, receipt, onClose, autoPrint }: { bill?: BillData; receipt?: ReceiptData; onClose: () => void; autoPrint?: PrintMode }) {
  const { mode, setMode, print } = usePrintMode(autoPrint ?? 'thermal');
  const [image, setImage] = useState('');
  const [error, setError] = useState('');

  const settings = useSettings();
  useEffect(() => {
    const draw = bill ? renderBillImage(bill, urdu.style.fontFamily, settings) : receipt ? renderReceiptImage(receipt, urdu.style.fontFamily, settings) : null;
    draw?.then((img) => {
      setImage(img);
      if (autoPrint) print(autoPrint);
    }).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill, receipt, settings]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const no = bill?.billNo ?? receipt?.receiptNo;
  // Rendered on <body>, outside the app shell, so printing can hide the shell and keep this.
  return createPortal(
    <div className="modal-scrim print-dialog" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="print-title" style={{ maxWidth: 900 }}>
        <div className="modal-head no-print">
          <span className="modal-icon info"><Icon name="print" /></span>
          <h2 id="print-title">{bill ? 'Bill' : 'Receipt'} {no}</h2>
          <button type="button" className="secondary icon-only" style={{ marginLeft: 'auto' }} aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <PrintPanel
          thermalImage={image} thermalError={error} mode={mode} setMode={setMode} print={print}
          a4={bill ? <BillA4 b={bill} /> : receipt ? <ReceiptA4 r={receipt} /> : null}
        />
      </div>
    </div>,
    document.body,
  );
}
