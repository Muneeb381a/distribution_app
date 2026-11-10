/**
 * Accounts that have signed in on this device, so the sign-in page can greet them by picture.
 * Only what the person already saw on screen (name, role, picture) is kept here, never a password or token.
 */
export interface KnownAccount { username: string; displayName: string | null; roleName: string; avatar: string | null; /** Business code the account belongs to; empty for the original business. */ business: string }

const KEY = 'dist.accounts';
const BUSINESS_KEY = 'dist.business';

/** The business code typed at the last sign-in on this device (empty = the original business). */
export function getBusiness(): string {
  try { return localStorage.getItem(BUSINESS_KEY) ?? ''; } catch { return ''; }
}
export function setBusiness(code: string) {
  try { localStorage.setItem(BUSINESS_KEY, code); } catch { /* a convenience only */ }
}
const MAX = 6;

export function knownAccounts(): KnownAccount[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as KnownAccount[]).map((a) => ({ ...a, business: a.business ?? '' })) : [];
  } catch {
    return [];
  }
}

export function rememberAccount(u: { username: string; displayName?: string | null; roleName: string; avatar?: string | null }) {
  const entry: KnownAccount = { username: u.username, displayName: u.displayName ?? null, roleName: u.roleName, avatar: u.avatar ?? null, business: getBusiness() };
  const rest = knownAccounts().filter((a) => a.username !== u.username || a.business !== entry.business);
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, MAX)));
  } catch { /* storage full or blocked: the picker is a convenience only */ }
}

export function forgetAccount(username: string, business = '') {
  try {
    localStorage.setItem(KEY, JSON.stringify(knownAccounts().filter((a) => a.username !== username || a.business !== business)));
  } catch { /* ignore */ }
}
