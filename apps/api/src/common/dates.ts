/**
 * A calendar day as a UTC-midnight Date (for @db.Date columns).
 * Given "2026-11-04" it returns that day; given nothing it returns the server's local today.
 */
export function dayOf(iso?: string): Date {
  if (iso) {
    const d = new Date(iso);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}
