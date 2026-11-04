'use client';

import { localDay } from '@dist/shared';

export interface Cheque { chequeNo: string; chequeBank: string; chequeDate: string }
export const EMPTY_CHEQUE: Cheque = { chequeNo: '', chequeBank: '', chequeDate: '' };

const BANKS = [
  'HBL', 'UBL', 'MCB', 'Allied Bank', 'Bank Alfalah', 'Meezan Bank', 'National Bank', 'Bank Al Habib', 'Askari Bank',
  'Faysal Bank', 'Bank of Punjab', 'Habib Metro', 'JS Bank', 'Soneri Bank', 'Standard Chartered', 'Dubai Islamic Bank',
];

/** Cheque number, bank and the date written on it (post-dated cheques can only be deposited from then). */
export default function ChequeFields({ value, onChange, id = 'cheque' }: { value: Cheque; onChange: (c: Cheque) => void; id?: string }) {
  const later = value.chequeDate && value.chequeDate > localDay();
  return (
    <fieldset className="cheque-fields">
      <legend>Cheque</legend>
      <label>Cheque no.
        <input required inputMode="numeric" maxLength={30} value={value.chequeNo} placeholder="000123" onChange={(e) => onChange({ ...value, chequeNo: e.target.value })} />
      </label>
      <div className="two">
        <label>Bank
          <input list={`${id}-banks`} maxLength={60} value={value.chequeBank} placeholder="HBL" onChange={(e) => onChange({ ...value, chequeBank: e.target.value })} />
          <datalist id={`${id}-banks`}>{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
        </label>
        <label>Date on cheque
          <input type="date" value={value.chequeDate || localDay()} onChange={(e) => onChange({ ...value, chequeDate: e.target.value })} />
        </label>
      </div>
      {later && <p className="cheque-hint">Post-dated: it can be deposited from {new Date(`${value.chequeDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.</p>}
    </fieldset>
  );
}

/** What the API wants: the cheque fields only when paying by cheque. */
export const chequeJson = (method: string, c: Cheque) =>
  method === 'CHEQUE' ? { chequeNo: c.chequeNo.trim(), chequeBank: c.chequeBank.trim() || undefined, chequeDate: c.chequeDate || undefined } : {};
