/**
 * Business details printed on bills, receipts and slips, and print preferences. One place to change
 * them (Settings screen); every print reads from here. Defaults apply until the owner saves.
 */
export interface BusinessSettings {
  /** Shown in the sidebar and on A4 documents. */
  businessName: string;
  /** Printed big at the top of thermal and A4 bills; Urdu shapes correctly because bills print as images. */
  urduName: string;
  /** Small line under the name, e.g. "Rice & Beverages". */
  tagline: string;
  address: string;
  /** One or more numbers, as they should print: "0300-1234567, 042-1234567". */
  phone: string;
  /** Tax number, printed only when set. */
  ntn: string;
  /** Last line of every bill and receipt. */
  footer: string;
  /** Short English note under the footer, e.g. return policy. */
  note: string;
  /** Thermal roll width in mm. */
  thermalWidth: 80 | 58;
}

export const DEFAULT_SETTINGS: BusinessSettings = {
  businessName: 'Distribution',
  urduName: 'ڈسٹری بیوشن',
  tagline: 'Rice & Beverages',
  address: '',
  phone: '',
  ntn: '',
  footer: 'شکریہ',
  note: '',
  thermalWidth: 80,
};

/** Limits the API checks and the form shows. */
export const SETTINGS_LIMITS = { businessName: 60, urduName: 40, tagline: 60, address: 160, phone: 60, ntn: 30, footer: 60, note: 120 } as const;

/** Saved values over the defaults; unknown keys are dropped. */
export function withDefaults(saved: Partial<BusinessSettings> | null | undefined): BusinessSettings {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof BusinessSettings)[]) {
    const v = saved?.[k];
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  }
  if (out.thermalWidth !== 58) out.thermalWidth = 80;
  return out;
}

/** "Main Bazar, Lahore · 0300-1234567" — the contact line under the name; empty parts left out. */
export const contactLine = (s: Pick<BusinessSettings, 'address' | 'phone'>) => [s.address, s.phone].map((x) => x.trim()).filter(Boolean).join(' · ');
