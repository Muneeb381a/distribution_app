import { useMemo, useSyncExternalStore } from 'react';
import { API_URL, ApiError } from './api';

/** The platform console has its own sign-in and token; it never shares them with a business's staff. */
const TOKEN_KEY = 'dist.platform.token';
const ADMIN_KEY = 'dist.platform.admin';
const EVENT = 'dist-platform-changed';

export interface PlatformAdmin { id: string; username: string; displayName: string | null }

export function savePlatformSession(token: string, admin: PlatformAdmin) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(ADMIN_KEY, JSON.stringify(admin));
  window.dispatchEvent(new Event(EVENT));
}

export function clearPlatformSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_KEY);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener('storage', cb); };
}

export function usePlatformAdmin(): PlatformAdmin | null {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(ADMIN_KEY), () => null);
  return useMemo(() => (raw ? (JSON.parse(raw) as PlatformAdmin) : null), [raw]);
}

export async function platformApi<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_URL}/platform${path}`, { ...rest, headers, body: json === undefined ? rest.body : JSON.stringify(json) });
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearPlatformSession();
    // Full reload on purpose: drops all in-memory state of the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/admin/login';
  }
  const body = await res.json().catch(() => null) as { message?: string | string[] } | null;
  if (!res.ok) {
    const m = body?.message;
    throw new ApiError(res.status, Array.isArray(m) ? m.join(', ') : (m ?? res.statusText), body);
  }
  return body as T;
}

// ---------------------------------------------------------------------------------------------- shapes

export type TenantStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED';

export interface Tenant {
  id: string; code: string; name: string; schemaName: string; isMain: boolean;
  contactName: string | null; phone: string | null; email: string | null; city: string | null;
  status: TenantStatus; expiresAt: string | null; maxUsers: number | null; notes: string | null; suspendedReason: string | null;
  createdAt: string; lastActiveAt: string | null;
  users: number; activeUsers: number; requests7d: number; requestsToday: number; activeNow: number;
  lastLoginAt: string | null; blocked: string | null; daysLeft: number | null;
  monthlyFee: string | null; lastPaymentOn?: string | null;
}

export interface LoginEvent {
  id: string; scope: 'TENANT' | 'PLATFORM'; tenantId: string | null; tenantCode: string | null; tenantName?: string | null;
  username: string; success: boolean; reason: string | null;
  ip: string | null; browser: string | null; os: string | null; device: string | null;
  country: string | null; region: string | null; city: string | null; createdAt: string;
}

export interface SeenRow {
  id: string; tenantId: string; tenantName?: string; tenantCode?: string; username: string;
  ip: string | null; browser: string | null; os: string | null; device: string | null;
  country: string | null; region: string | null; city: string | null;
  firstSeen: string; lastSeen: string; hits: number; activeNow?: boolean;
}

// ---------------------------------------------------------------------------------------------- showing things

/** "3 min ago", "2 days ago". */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86_400 * 30) return `${Math.round(s / 86_400)} d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const place = (r: { city: string | null; region?: string | null; country: string | null }) =>
  [r.city, r.country].filter(Boolean).join(', ') || 'Unknown place';

export const deviceLine = (r: { browser: string | null; os: string | null; device: string | null }) =>
  [r.device, [r.browser, r.os].filter(Boolean).join(' on ')].filter(Boolean).join(' · ') || 'Unknown device';

/** The business's state as one word and one colour. */
export function stateOf(t: Pick<Tenant, 'status' | 'blocked' | 'daysLeft' | 'expiresAt'>): { label: string; tone: 'green' | 'amber' | 'red' | 'blue' | '' } {
  if (t.status === 'SUSPENDED') return { label: 'Suspended', tone: 'red' };
  if (t.expiresAt && (t.daysLeft ?? 0) < 0) return { label: 'Expired', tone: 'red' };
  if (t.expiresAt && (t.daysLeft ?? 99) <= 7) return { label: `Ends in ${t.daysLeft} d`, tone: 'amber' };
  if (t.status === 'TRIAL') return { label: 'Trial', tone: 'blue' };
  return { label: 'Active', tone: 'green' };
}

// ---------------------------------------------------------------------------------------------- money, size, messages

export const rs = (n: number | string | null | undefined) => (n == null || n === '' ? '—' : `Rs ${Math.round(Number(n)).toLocaleString('en-PK')}`);

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** A WhatsApp link for a Pakistani number written the usual ways (0300-1234567, +92 300 1234567). */
export function whatsapp(phone: string, text: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = `92${d.slice(1)}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export function renewalMessage(t: { name: string; contactName: string | null; expiresAt: string | null; daysLeft: number | null }): string {
  const who = t.contactName ? ` ${t.contactName}` : '';
  const when = t.expiresAt ? new Date(t.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  if (t.expiresAt && (t.daysLeft ?? 0) < 0) return `Assalam o Alaikum${who}, ${t.name} ka software account ${when} ko khatam ho gaya hai. Dobara chalane ke liye barae meharbani renew kar dein. Shukriya.`;
  if (t.expiresAt) return `Assalam o Alaikum${who}, ${t.name} ka software account ${when} ko khatam ho raha hai. Barae meharbani time par renew kar dein taa ke kaam na rukay. Shukriya.`;
  return `Assalam o Alaikum${who}, ${t.name} ke software account ke baare mein baat karni thi. Shukriya.`;
}

export const METHODS: { value: string; label: string }[] = [
  { value: 'CASH', label: 'Cash' }, { value: 'BANK', label: 'Bank transfer' }, { value: 'JAZZCASH', label: 'JazzCash' }, { value: 'EASYPAISA', label: 'Easypaisa' }, { value: 'OTHER', label: 'Other' },
];
export const methodLabel = (m: string) => METHODS.find((x) => x.value === m)?.label ?? m;

export interface Payment {
  id: string; tenantId: string; amount: string; method: string; paidOn: string; months: number; note: string | null; createdByName: string; createdAt: string;
  tenantName?: string; tenantCode?: string;
}
