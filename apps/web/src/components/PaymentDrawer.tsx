'use client';

import { useState, type FormEvent } from 'react';
import { BusyButton, useToast } from '@/components/Feedback';
import { Affix, Choice, Field, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { METHODS, platformApi, rs } from '@/lib/platform';

export interface PayTarget { id: string; name: string; monthlyFee: string | null; expiresAt: string | null }

const addMonths = (from: Date, n: number) => { const d = new Date(from); d.setMonth(d.getMonth() + n); return d; };

/** Record money received from a business; its access end date moves forward by the months paid for. */
export function PaymentDrawer({ tenant, onClose, onDone }: { tenant: PayTarget; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(tenant.monthlyFee ? String(Math.round(Number(tenant.monthlyFee))) : '');
  const [method, setMethod] = useState('JAZZCASH');
  const [months, setMonths] = useState(1);
  const [today] = useState(() => new Date());
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // What the end date will become, worked out the same way the server does.
  const runningOn = !!tenant.expiresAt && new Date(tenant.expiresAt).getTime() > today.getTime();
  const base = runningOn ? new Date(tenant.expiresAt!) : today;
  const until = addMonths(base, months);
  const fee = Number(tenant.monthlyFee ?? 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await platformApi(`/tenants/${tenant.id}/payments`, { method: 'POST', json: { amount: Number(amount), method, months, paidOn, note: note || undefined } });
      toast.success(`${rs(amount)} recorded. Access now runs until ${until.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="drawer-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="pay-title" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
        <form onSubmit={submit}>
          <header className="drawer-head">
            <span className="drawer-icon"><Icon name="wallet" /></span>
            <div><h2 id="pay-title">Record a payment</h2><p>{tenant.name}</p></div>
            <button type="button" className="drawer-x" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
          </header>
          <div className="drawer-body">
            <div className="pay-preview" aria-live="polite">
              <span>Access will run until</span>
              <b>{until.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</b>
              <small>{months} month{months === 1 ? '' : 's'} added to {runningOn ? 'the current end date' : 'today'}</small>
            </div>
            <FormSection>
              <Field label="Amount received" required span={12} hint={fee ? `Monthly fee is ${rs(fee)}${months > 1 ? `; ${months} months is ${rs(fee * months)}` : ''}.` : undefined}>
                <Affix prefix="Rs"><input className="big" type="number" min={1} step="any" required autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Affix>
              </Field>
              <Field label="Months paid for" span={12}>
                <div className="chips" role="group" aria-label="Months">
                  {[1, 2, 3, 6, 12].map((n) => (
                    <button key={n} type="button" className={`chip${months === n ? ' on' : ''}`} aria-pressed={months === n} onClick={() => { setMonths(n); if (fee) setAmount(String(Math.round(fee * n))); }}>{n === 12 ? '1 year' : `${n} month${n > 1 ? 's' : ''}`}</button>
                  ))}
                </div>
              </Field>
              <Field label="How it was paid" span={12}>
                <Choice name="pay-method" value={method} onChange={setMethod} columns={3} options={METHODS.map((m) => ({ value: m.value, label: m.label }))} />
              </Field>
              <Field label="Received on" span={6}><input type="date" required value={paidOn} max={today.toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <Field label="Note" optional span={6}><input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. receipt no." /></Field>
            </FormSection>
          </div>
          <footer className="drawer-foot">
            <span className="drawer-note"><span className="req">*</span> required</span>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <BusyButton busy={busy} disabled={!Number(amount)}><Icon name="check" />{busy ? 'Saving…' : 'Record payment'}</BusyButton>
          </footer>
        </form>
      </aside>
    </div>
  );
}
