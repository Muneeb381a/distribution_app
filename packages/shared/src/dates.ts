/**
 * Calendar days in the shop's local time (the PC and server run on Pakistan time).
 * Never use `new Date().toISOString().slice(0, 10)` for "today": that is the UTC day, which is still
 * yesterday in Pakistan until 5 am.
 */

/** "2026-11-04" for a Date in local time. */
export function localDay(d: Date = new Date()): string {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Midnight local time of a "YYYY-MM-DD" day. */
export const parseDay = (day: string) => new Date(`${day}T00:00:00`);

export const addDays = (d: Date, k: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + k);
export const monthStart = (d: Date = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1);
export const monthEnd = (d: Date = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0);

/** "2026-11" → "November 2026". */
export const monthName = (month: string) => parseDay(`${month}-01`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

type DateStyle = 'day' | 'short' | 'medium' | 'long' | 'datetime' | 'time';
const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  day: { day: 'numeric', month: 'short' },
  short: { day: 'numeric', month: 'short', year: 'numeric' },
  medium: { dateStyle: 'medium' },
  long: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
  time: { hour: '2-digit', minute: '2-digit' },
};

/** One way to show dates everywhere. Accepts an ISO timestamp, a "YYYY-MM-DD" day or a Date. */
export function formatDate(v: string | Date | null | undefined, style: DateStyle = 'short'): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? (/^\d{4}-\d{2}-\d{2}$/.test(v) ? parseDay(v) : new Date(v)) : v;
  if (Number.isNaN(d.getTime())) return '—';
  return style === 'time' ? d.toLocaleTimeString('en-GB', STYLES.time) : d.toLocaleString('en-GB', STYLES[style]);
}

/** "just now", "5 min ago", "3 h ago", or the date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return formatDate(iso, 'datetime');
}

/** Date-range presets used by reports, the audit log and lists. */
export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'all';
export function presetRange(p: RangePreset, now: Date = new Date()): [string, string] {
  switch (p) {
    case 'today': return [localDay(now), localDay(now)];
    case 'yesterday': return [localDay(addDays(now, -1)), localDay(addDays(now, -1))];
    case '7d': return [localDay(addDays(now, -6)), localDay(now)];
    case '30d': return [localDay(addDays(now, -29)), localDay(now)];
    case 'month': return [localDay(monthStart(now)), localDay(now)];
    case 'lastMonth': return [localDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), localDay(monthEnd(new Date(now.getFullYear(), now.getMonth() - 1, 1)))];
    default: return ['', ''];
  }
}
