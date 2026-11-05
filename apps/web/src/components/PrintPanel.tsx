'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { useSettings } from '@/lib/settings';

export type PrintMode = 'thermal' | 'a4';

/** Print mode + a print() that applies it before the browser's print dialog opens. */
export function usePrintMode(initial: PrintMode = 'thermal') {
  const [mode, setMode] = useState<PrintMode>(initial);
  const print = useCallback((next?: PrintMode) => {
    if (next) setMode(next);
    // Let React apply the mode attribute before the print dialog snapshots the page.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }, []);
  return { mode, setMode, print };
}

interface Props {
  /** PNG data URL of the thermal version (80 or 58 mm, from Settings). */
  thermalImage: string;
  /** Set when the thermal image could not be drawn. */
  thermalError?: string;
  /** The A4 version, plain HTML. */
  a4: ReactNode;
  mode: PrintMode;
  setMode: (m: PrintMode) => void;
  print: (m?: PrintMode) => void;
}

/**
 * Print preview with thermal / A4 tabs. Only the chosen version is printed.
 * "A4" also covers WhatsApp: choose "Save as PDF" in the print dialog and share the file.
 */
export default function PrintPanel({ thermalImage, thermalError, a4, mode, setMode, print }: Props) {
  const { thermalWidth } = useSettings();
  return (
    <section className="card print-card" data-print={mode} aria-label="Print preview">
      <div className="print-tabs no-print">
        <div className="seg" role="tablist" aria-label="Paper">
          <button type="button" role="tab" aria-selected={mode === 'thermal'} className={mode === 'thermal' ? 'on' : ''} onClick={() => setMode('thermal')}>Thermal {thermalWidth} mm</button>
          <button type="button" role="tab" aria-selected={mode === 'a4'} className={mode === 'a4' ? 'on' : ''} onClick={() => setMode('a4')}>A4 / PDF</button>
        </div>
        <div className="actions">
          <span className="paper-note">{mode === 'a4' ? 'For WhatsApp, pick “Save as PDF” in the print dialog.' : 'Prints as an image, so Urdu always shows correctly.'}</span>
          <button type="button" onClick={() => print()}><Icon name="print" />Print {mode === 'a4' ? 'A4' : 'thermal'}</button>
        </div>
      </div>
      <div className="doc-preview print-stage">
        <div className={`thermal-img card${mode === 'thermal' ? '' : ' screen-hidden'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thermalImage ? <img src={thermalImage} alt="Thermal print preview" style={{ width: `${thermalWidth}mm`, maxWidth: '100%' }} />
            : thermalError ? <span className="error">Could not draw the thermal print: {thermalError}</span>
            : <span className="skeleton" style={{ display: 'block', width: '100%', height: 360 }} aria-label="Preparing preview" />}
        </div>
        <div className={`a4doc card${mode === 'a4' ? '' : ' screen-hidden'}`}>{a4}</div>
      </div>
    </section>
  );
}
