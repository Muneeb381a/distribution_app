import { docStatus, dueStatus, lineLabel, lineTone, type Tone } from '@dist/shared';
import type { ReactNode } from 'react';

/** The one badge. Colours come from the tone, words from @dist/shared labels. */
export function Badge({ tone = '', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`badge${tone ? ` ${tone}` : ''}`} title={title}>{children}</span>;
}

/** Active / Cancelled. */
export function StatusBadge({ status }: { status: string }) {
  const s = docStatus(status);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Bottles / Rice / Shared. */
export function LineBadge({ line }: { line: string | null | undefined }) {
  return <Badge tone={lineTone(line)}>{lineLabel(line)}</Badge>;
}

/** Cancelled / Udhaar 1,200 / Paid — what is still owed on a bill (or "Due" on a purchase). */
export function DueBadge({ status, total, paid, word }: { status: string; total: string | number; paid: string | number; word?: 'Udhaar' | 'Due' }) {
  const s = dueStatus(status, Number(total), Number(paid), word);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
