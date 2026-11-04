'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';

export type SortDir = 'asc' | 'desc';
export interface SortState<K extends string> { key: K | null; dir: SortDir }

/**
 * Client-side sort. `get` maps a row and key to a sortable value;
 * numbers (or numeric strings) sort numerically, everything else alphabetically.
 */
export function useSort<T, K extends string>(rows: T[], get: (row: T, key: K) => unknown, initial: SortState<K> = { key: null, dir: 'asc' }) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    if (!sort.key) return rows;
    const k = sort.key;
    const val = (r: T) => {
      const v = get(r, k);
      if (v == null || v === '') return null;
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN;
      return Number.isNaN(n) ? String(v).toLowerCase() : n;
    };
    const m = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : 1) * m;
    });
    // `get` is a pure accessor; callers usually pass an inline function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return { sorted, sort, toggle };
}

/** Clickable, keyboard-accessible sortable header cell. */
export function SortTh<K extends string>({ k, sort, toggle, children, num }: { k: K; sort: SortState<K>; toggle: (k: K) => void; children: ReactNode; num?: boolean }) {
  const on = sort.key === k;
  return (
    <th className={`sortable${num ? ' num' : ''}${on ? ' sorted' : ''}`} aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => toggle(k)}>
        {children}
        <Icon name={on ? (sort.dir === 'asc' ? 'sortUp' : 'sortDown') : 'sortBoth'} />
      </button>
    </th>
  );
}

/** Show rows a page at a time with a "Load more" button. */
export function usePaged<T>(rows: T[], size = 25) {
  const [limit, setLimit] = useState(size);
  const page = useMemo(() => rows.slice(0, limit), [rows, limit]);
  return {
    page,
    more: rows.length > limit,
    remaining: Math.max(0, rows.length - limit),
    loadMore: () => setLimit((l) => l + size),
    reset: () => setLimit(size),
  };
}

export function LoadMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (total <= shown) return null;
  return (
    <div className="load-more">
      <span className="muted">Showing {shown.toLocaleString()} of {total.toLocaleString()}</span>
      <button type="button" className="secondary" onClick={onMore}>Load {Math.min(25, total - shown)} more</button>
    </div>
  );
}

/** Make a whole row open a link, while keeping inner links/buttons working. */
export function rowLink(go: () => void) {
  return {
    className: 'row-link',
    tabIndex: 0,
    onClick: (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('a, button, input, select')) go(); },
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' && e.target === e.currentTarget) go(); },
  };
}

/** Download rows as a CSV file (opens in Excel). */
export function downloadCsv(filename: string, head: string[], rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
