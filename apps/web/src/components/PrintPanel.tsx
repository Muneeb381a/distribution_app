'use client';

import { useState, type ReactNode } from 'react';

interface Props {
  /** PNG data URL of the 80 mm thermal version. */
  thermalImage: string;
  /** The A4 version, plain HTML. */
  a4: ReactNode;
}

/**
 * Print buttons for one document. "Print A4" also covers WhatsApp: choose "Save as PDF" in the print
 * dialog and share the file.
 */
export default function PrintPanel({ thermalImage, a4 }: Props) {
  const [mode, setMode] = useState<'thermal' | 'a4'>('thermal');

  function print(next: 'thermal' | 'a4') {
    setMode(next);
    // Let React apply the mode class before the print dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  return (
    <div data-print={mode}>
      <div className="toolbar no-print">
        <button onClick={() => print('thermal')}>Print thermal (80 mm)</button>
        <button className="secondary" onClick={() => print('a4')}>Print A4 / Save as PDF</button>
      </div>
      <div className="doc-preview">
        <div className="thermal-img card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thermalImage ? <img src={thermalImage} alt="Thermal print" style={{ width: '80mm', maxWidth: '100%' }} /> : <span className="muted">Preparing…</span>}
        </div>
        <div className="a4doc card">{a4}</div>
      </div>
    </div>
  );
}
