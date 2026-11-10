/**
 * Everything this browser keeps for one business (offline data, unsent bills, receipt details, device number) is stored
 * under that business's own name, so staff of one business who sign in on the same computer never see, or send,
 * another business's data. The original business keeps the old names, so nothing already saved is lost.
 */
const TOKEN_KEY = 'dist.token';

/** The business the current sign-in belongs to, read from the token the server signed. */
export function activeBusiness(): string {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return 'main';
    const body = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(body.padEnd(body.length + ((4 - (body.length % 4)) % 4), '='))) as { tid?: string };
    return payload.tid ?? 'main';
  } catch {
    return 'main';
  }
}

/** A storage key or database name that belongs to the current business only. */
export function scoped(name: string): string {
  const b = activeBusiness();
  return b === 'main' ? name : `${name}.${b}`;
}
