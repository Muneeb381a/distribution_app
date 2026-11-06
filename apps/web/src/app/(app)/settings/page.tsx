'use client';

import { useEffect, useState, type FormEvent } from 'react';
import AppearancePanel from '@/components/AppearancePanel';
import { BusyButton, useToast } from '@/components/Feedback';
import { Choice, Field, FormActions, FormCard, FormSection } from '@/components/Form';
import { Icon } from '@/components/Icon';
import { api, can, useUser } from '@/lib/api';
import { urdu } from '@/lib/fonts';
import { usePageTitle } from '@/lib/pageTitle';
import { renderBillImage, type BillData } from '@/lib/saleImage';
import { settingsSaved, useSettings } from '@/lib/settings';
import { SETTINGS_LIMITS as L, type BusinessSettings } from '@dist/shared';

/** A made-up bill for the preview, so changes can be seen before anything is printed. */
const SAMPLE: BillData = {
  billNo: 'B-000123', date: new Date().toISOString(), createdAt: new Date().toISOString(), status: 'ACTIVE', saleType: 'CREDIT',
  customer: { name: 'Bilal Kiryana Store', shopName: 'Main Bazar', creditLimit: '50000' },
  salesman: { name: 'Asif' },
  items: [
    { product: { name: 'Pepsi', size: '1.5 L' }, unitName: 'CARTON', qty: '5', rate: '1350', lineTotal: '6750' },
    { product: { name: 'Super Kernel Sella', size: null }, unitName: 'KG', qty: '25', rate: '340', lineTotal: '8500' },
  ],
  returns: [], gross: '15250', returnsCredit: '0', net: '15250', paidNow: '5000',
  previousBalance: '12000', newBalance: '22250', availableCredit: '27750', empties: null,
};

export default function SettingsPage() {
  usePageTitle('Settings');
  const user = useUser();
  const toast = useToast();
  const saved = useSettings();
  const [f, setF] = useState<BusinessSettings>(saved);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'business' | 'look'>('business');
  const [preview, setPreview] = useState('');
  const editable = can(user, 'SETTINGS_EDIT');
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);

  // The form starts from the saved values once they arrive from the server.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF(saved);
  }, [saved]);

  // Redraw the sample bill shortly after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      renderBillImage(SAMPLE, urdu.style.fontFamily, f).then(setPreview).catch(() => setPreview(''));
    }, 250);
    return () => clearTimeout(t);
  }, [f]);

  const set = (patch: Partial<BusinessSettings>) => setF({ ...f, ...patch });
  const text = (k: keyof typeof L, props: { placeholder?: string; dir?: 'rtl'; className?: string } = {}) => (
    <input value={String(f[k] ?? '')} maxLength={L[k]} disabled={!editable} onChange={(e) => set({ [k]: e.target.value })} {...props} />
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const next = await api<BusinessSettings>('/settings', { method: 'PUT', json: f });
      settingsSaved(next);
      toast.success('Settings saved. New bills and slips use them now.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Your business details and how bills print. Change them here once; every bill, receipt and slip uses them.</p>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Settings sections">
        <button type="button" role="tab" aria-selected={tab === 'business'} onClick={() => setTab('business')}>Business &amp; bills</button>
        <button type="button" role="tab" aria-selected={tab === 'look'} onClick={() => setTab('look')}>Appearance</button>
      </div>

      {tab === 'look' && <AppearancePanel />}
      {tab === 'business' && <div className="settings-grid">
        <FormCard onSubmit={submit}
          actions={editable ? (
            <FormActions note={dirty ? 'Unsaved changes' : 'All changes saved'}>
              {dirty && <button type="button" className="secondary" onClick={() => setF(saved)}>Discard</button>}
              <BusyButton type="submit" busy={busy} disabled={!dirty}><Icon name="check" />Save settings</BusyButton>
            </FormActions>
          ) : undefined}>
          <FormSection title="Business" description="Printed at the top of every bill. The Urdu name prints big on thermal bills.">
            <Field label="Business name" required span={6}>{text('businessName', { placeholder: 'Ali Traders' })}</Field>
            <Field label="Name in Urdu" optional span={6}>{text('urduName', { dir: 'rtl', className: urdu.className, placeholder: 'علی ٹریڈرز' })}</Field>
            <Field label="Line under the name" optional span={12} hint="What you deal in, e.g. Rice & Beverages">{text('tagline')}</Field>
          </FormSection>
          <FormSection title="Contact" description="Printed under the name so customers can reach you.">
            <Field label="Address" optional span={12}>{text('address', { placeholder: 'Shop 12, Grain Market, Okara' })}</Field>
            <Field label="Phone" optional span={6} hint="Several numbers can go here, separated by commas">{text('phone', { placeholder: '0300-1234567' })}</Field>
            <Field label="NTN" optional span={6} hint="Printed only if filled">{text('ntn')}</Field>
          </FormSection>
          <FormSection title="Bills" description="The last lines of every bill and receipt.">
            <Field label="Footer (Urdu)" optional span={12}>{text('footer', { dir: 'rtl', className: urdu.className, placeholder: 'شکریہ' })}</Field>
            <Field label="Note" optional span={12} hint="Short English line, e.g. return policy">{text('note', { placeholder: 'Goods once sold are returnable within 7 days with the bill.' })}</Field>
          </FormSection>
          <FormSection title="Thermal printer" description="Pick the width of the paper roll in your printer. The preview shows the result.">
            <Field label="Roll width" span={12}>
              <Choice name="roll" value={String(f.thermalWidth) as '80' | '58'} onChange={(v) => editable && set({ thermalWidth: v === '58' ? 58 : 80 })} columns={2} options={[
                { value: '80', label: '80 mm', description: 'Standard counter printer', icon: 'print' },
                { value: '58', label: '58 mm', description: 'Small / portable printer', icon: 'print' },
              ]} />
            </Field>
          </FormSection>
        </FormCard>

        <aside className="settings-preview">
          <div className="card">
            <div className="card-head"><h2>Bill preview</h2><span className="badge">{f.thermalWidth} mm</span></div>
            <div className="settings-roll" style={{ maxWidth: f.thermalWidth === 58 ? 240 : 320 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {preview ? <img src={preview} alt="Sample thermal bill" /> : <span className="skeleton" style={{ display: 'block', height: 420 }} />}
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>A sample bill, not saved anywhere. A4 bills and salary slips use the same details.</p>
          </div>
        </aside>
      </div>}
    </>
  );
}
