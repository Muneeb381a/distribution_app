'use client';

import { useState, type FormEvent } from 'react';
import { BusyButton, useToast } from '@/components/Feedback';
import { Affix, Choice, Field } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { api } from '@/lib/api';
import { money, productLabel, tierLabel, unitLabel } from '@dist/shared';

interface Row { productId: string; name: string; size: string | null; unitName: string; tier: string; from: string; to: string; skipped: boolean }
interface Result { applied: boolean; changed: number; withoutRate: number; rows: Row[] }

/**
 * Change the list rates of the products shown at once — the usual case is a company price rise:
 * "+5%" or "+Rs 60 a peti" (bottle rates follow in step). Shows every new rate before anything changes.
 */
export default function ChangeRatesDialog({ productIds, line, onClose, onDone }: {
  productIds: string[]; line: 'BOTTLES' | 'RICE'; onClose: () => void; onDone: (changed: number) => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'percent' | 'amount'>('percent');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(line === 'BOTTLES' ? 'CARTON' : 'KG');
  const [roundTo, setRoundTo] = useState(1);
  const [tier, setTier] = useState<'' | 'RETAIL' | 'WHOLESALE'>('');
  const [preview, setPreview] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const units = line === 'BOTTLES' ? [['CARTON', 'peti'], ['BOTTLE', 'bottle']] : [['KG', 'kg'], ['MAUND', 'maund'], ['BAG', 'bag']];

  const body = () => ({
    productIds, roundTo, tier: tier || undefined,
    ...(mode === 'percent' ? { percent: Number(value) } : { amount: Number(value), unitName: unit }),
  });

  async function run(apply: boolean) {
    setBusy(true);
    try {
      const r = await api<Result>('/product-prices/change', { method: 'POST', json: { ...body(), preview: !apply } });
      if (apply) { onDone(r.changed); return; }
      setPreview(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); run(!!preview); };
  const reset = () => setPreview(null);

  return (
    <div className="modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-labelledby="rates-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <form onSubmit={submit}>
          <div className="modal-head">
            <span className="modal-icon info"><Icon name="trend" /></span>
            <h2 id="rates-title">Change rates of {productIds.length} product{productIds.length === 1 ? '' : 's'}</h2>
          </div>
          <p className="card-sub" style={{ margin: '0 0 14px' }}>The products now shown in the list. Filter the list first to change one brand or category. Customer fixed rates are not touched.</p>
          <div className="fgrid">
            <Field label="Change by" span={12}>
              <Choice name="rate-mode" value={mode} columns={2} onChange={(v) => { setMode(v); reset(); }} options={[
                { value: 'percent', label: 'Percentage', description: 'Every unit, e.g. +5%', icon: 'trend' },
                { value: 'amount', label: 'Fixed amount', description: 'Per one unit, e.g. +Rs 60 a peti', icon: 'wallet' },
              ]} />
            </Field>
            {mode === 'percent' ? (
              <Field label="Percentage" required span={6} hint="Negative to lower, e.g. -3">
                <Affix suffix="%"><input type="number" step="any" required inputMode="decimal" value={value} placeholder="5" onChange={(e) => { setValue(e.target.value); reset(); }} /></Affix>
              </Field>
            ) : (
              <>
                <Field label="Amount" required span={6} hint="Other units move in step">
                  <Affix prefix="Rs"><input type="number" step="any" required inputMode="decimal" value={value} placeholder="60" onChange={(e) => { setValue(e.target.value); reset(); }} /></Affix>
                </Field>
                <Field label="Per" span={6}>
                  <select value={unit} onChange={(e) => { setUnit(e.target.value); reset(); }}>{units.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                </Field>
              </>
            )}
            <Field label="Price list" span={6}>
              <div className="chips">
                {([['', 'Both'], ['RETAIL', 'Retail'], ['WHOLESALE', 'Wholesale']] as const).map(([v, l]) => (
                  <button key={l} type="button" className={`chip${tier === v ? ' on' : ''}`} aria-pressed={tier === v} onClick={() => { setTier(v); reset(); }}>{l}</button>
                ))}
              </div>
            </Field>
            <Field label="Round new rates to" span={6}>
              <div className="chips">
                {[[0.01, 'Paisa'], [1, 'Rs 1'], [5, 'Rs 5'], [10, 'Rs 10']].map(([v, l]) => (
                  <button key={v} type="button" className={`chip${roundTo === v ? ' on' : ''}`} aria-pressed={roundTo === v} onClick={() => { setRoundTo(Number(v)); reset(); }}>{l}</button>
                ))}
              </div>
            </Field>
          </div>

          {preview && (
            <div className="rates-preview">
              <p className="muted" style={{ margin: '14px 0 8px', fontSize: 13 }}>
                {preview.changed} rate{preview.changed === 1 ? '' : 's'} will change{preview.withoutRate ? ` · ${preview.withoutRate} product${preview.withoutRate === 1 ? ' has' : 's have'} no list rate and stay as they are` : ''}.
              </p>
              <div className="table-wrap" style={{ maxHeight: 280, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Product</th><th>Unit</th><th>List</th><th className="num">Now</th><th className="num">New</th></tr></thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={`${r.productId}|${r.unitName}|${r.tier}`} className={r.skipped ? 'inactive' : ''}>
                        <td>{productLabel(r)}</td><td>{unitLabel(r.unitName)}</td><td>{tierLabel(r.tier)}</td>
                        <td className="num muted">{money(r.from)}</td>
                        <td className="num"><b className={Number(r.to) > Number(r.from) ? 'amt-debit' : Number(r.to) < Number(r.from) ? 'amt-credit' : ''}>{r.skipped ? 'no such unit' : money(r.to)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <BusyButton type="submit" busy={busy} disabled={!value || !Number(value) || (!!preview && !preview.changed)}>
              {preview ? <><Icon name="check" />Apply {preview.changed} new rate{preview.changed === 1 ? '' : 's'}</> : 'Preview new rates'}
            </BusyButton>
          </div>
        </form>
      </div>
    </div>
  );
}
