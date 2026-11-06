/**
 * Accounts that have signed in on this device, so the sign-in page can greet them by picture.
 * Only what the person already saw on screen (name, role, picture) is kept here, never a password or token.
 */
export interface KnownAccount { username: string; displayName: string | null; roleName: string; avatar: string | null }

const KEY = 'dist.accounts';
const MAX = 6;

export function knownAccounts(): KnownAccount[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as KnownAccount[]) : [];
  } catch {
    return [];
  }
}

export function rememberAccount(u: { username: string; displayName?: string | null; roleName: string; avatar?: string | null }) {
  const entry: KnownAccount = { username: u.username, displayName: u.displayName ?? null, roleName: u.roleName, avatar: u.avatar ?? null };
  const rest = knownAccounts().filter((a) => a.username !== u.username);
  try {
    localStorage.setItem(KEY, JSON.stringify([entry, ...rest].slice(0, MAX)));
  } catch { /* storage full or blocked: the picker is a convenience only */ }
}

export function forgetAccount(username: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(knownAccounts().filter((a) => a.username !== username)));
  } catch { /* ignore */ }
}
