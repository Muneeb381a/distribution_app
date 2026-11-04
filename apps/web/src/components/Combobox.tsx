'use client';

import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/Icon';

export interface ComboOption {
  value: string;
  label: string;
  /** Second line: shop, area, size… */
  sub?: string;
  /** Extra text that matches the search but is not shown (phone, code…). */
  keywords?: string;
  /** Small tag on the right, e.g. "Udhaar". */
  tag?: string;
}

interface Props {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Shown as an extra first option with value "" (e.g. "Walk-in (cash)"). */
  emptyLabel?: string;
  /** localStorage key for "recent / frequent" options shown first when the box is empty. */
  recentKey?: string;
  required?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  /** Called after a choice is made with the keyboard (Enter) — e.g. move to the next field. */
  onPicked?: () => void;
}

export interface ComboHandle { focus: () => void }

const MAX_SHOWN = 60;
type Recent = Record<string, { n: number; t: number }>;

function readRecent(key?: string): Recent {
  if (!key) return {};
  try { return JSON.parse(localStorage.getItem(`dist.recent.${key}`) ?? '{}') as Recent; } catch { return {}; }
}
function bumpRecent(key: string | undefined, value: string) {
  if (!key || !value) return;
  try {
    const r = readRecent(key);
    r[value] = { n: (r[value]?.n ?? 0) + 1, t: Date.now() };
    // keep the 40 best
    const best = Object.entries(r).sort((a, b) => score(b[1]) - score(a[1])).slice(0, 40);
    localStorage.setItem(`dist.recent.${key}`, JSON.stringify(Object.fromEntries(best)));
  } catch { /* storage blocked: recents are a convenience only */ }
}
/** Frequency, with recent use counting more (half-life ~2 weeks). */
const score = (x: { n: number; t: number }) => x.n * Math.pow(0.5, (Date.now() - x.t) / (14 * 86_400_000)) + x.t / 1e15;

const norm = (s: string) => s.toLowerCase().normalize('NFKD');
const splitWords = (q: string) => norm(q).split(/\s+/).filter(Boolean);

/**
 * Searchable select: type to filter, ↑/↓ to move, Enter to pick, Esc to close.
 * Handles thousands of options (only the first matches are rendered).
 */
const Combobox = forwardRef<ComboHandle, Props>(function Combobox(
  { options, value, onChange, placeholder = 'Search…', emptyLabel, recentKey, required, disabled, ariaLabel, id, onPicked },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<Recent>({});
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);

  const selected = options.find((o) => o.value === value);

  const { shown, total } = useMemo(() => {
    const words = splitWords(q);
    let out: (ComboOption & { recent?: boolean })[];
    if (!words.length) {
      const rec = options
        .filter((o) => recent[o.value])
        .sort((a, b) => score(recent[b.value]) - score(recent[a.value]))
        .slice(0, 5)
        .map((o) => ({ ...o, recent: true }));
      const recSet = new Set(rec.map((o) => o.value));
      out = [...rec, ...options.filter((o) => !recSet.has(o.value))];
    } else {
      out = options.filter((o) => {
        const hay = norm(`${o.label} ${o.sub ?? ''} ${o.keywords ?? ''}`);
        return words.every((w) => hay.includes(w));
      });
      // names starting with the query first
      const w0 = words[0];
      out.sort((a, b) => Number(norm(b.label).startsWith(w0)) - Number(norm(a.label).startsWith(w0)));
    }
    const withEmpty = emptyLabel !== undefined && !words.length ? [{ value: '', label: emptyLabel }, ...out] : out;
    return { shown: withEmpty.slice(0, MAX_SHOWN), total: words.length ? out.length : options.length };
  }, [options, q, recent, emptyLabel]);

  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) close(); };
    window.addEventListener('mousedown', click);
    return () => window.removeEventListener('mousedown', click);
  });

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function openList() {
    if (disabled) return;
    setRecent(readRecent(recentKey));
    setOpen(true);
    setActive(0);
  }
  function close() {
    setOpen(false);
    setQ('');
  }
  function pick(o: ComboOption, viaKeyboard = false) {
    onChange(o.value);
    bumpRecent(recentKey, o.value);
    close();
    if (viaKeyboard) onPicked?.();
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) openList(); else setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      if (open && shown[active]) { e.preventDefault(); pick(shown[active], true); }
      else if (!open) { e.preventDefault(); openList(); }
    }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); close(); } }
    else if (e.key === 'Tab') { if (open && q && shown[active]) pick(shown[active]); else close(); }
  }

  const display = open ? q : selected ? selected.label + (selected.sub ? ` · ${selected.sub}` : '') : '';
  const ph = open ? (selected ? selected.label : placeholder) : value === '' && emptyLabel ? emptyLabel : placeholder;

  return (
    <div className={`combo${open ? ' open' : ''}${disabled ? ' disabled' : ''}`} ref={box}>
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={display}
        placeholder={ph}
        onChange={(e) => { setQ(e.target.value); setActive(0); if (!open) { setRecent(readRecent(recentKey)); setOpen(true); } }}
        onFocus={openList}
        onClick={() => { if (!open) openList(); }}
        onKeyDown={onKey}
      />
      {/* keeps native "required" validation working */}
      {required && <input className="combo-req" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} onFocus={() => input.current?.focus()} />}
      {value && !required && !disabled ? (
        <button type="button" className="combo-clear" aria-label="Clear" tabIndex={-1} onMouseDown={(e) => { e.preventDefault(); onChange(''); input.current?.focus(); }}><Icon name="x" /></button>
      ) : (
        <span className="combo-caret" aria-hidden="true"><Icon name="chevronDown" /></span>
      )}
      {open && (
        <ul className="combo-pop" role="listbox" id={listId} ref={list}>
          {shown.map((o, i) => {
            const head = 'recent' in o && o.recent && (i === 0 || !('recent' in shown[i - 1] && shown[i - 1].recent));
            const after = i > 0 && 'recent' in shown[i - 1] && shown[i - 1].recent && !('recent' in o && o.recent);
            return (
              <li key={`${o.value}-${i}`} role="presentation">
                {head && <div className="combo-group">Recent</div>}
                {after && <div className="combo-group">All</div>}
                <div
                  role="option"
                  id={`${listId}-${i}`}
                  aria-selected={o.value === value}
                  data-active={i === active}
                  className={`combo-opt${i === active ? ' active' : ''}${o.value === value ? ' sel' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                >
                  <span className="combo-main"><b>{o.label}</b>{o.sub && <span>{o.sub}</span>}</span>
                  {o.tag && <span className="badge amber">{o.tag}</span>}
                  {o.value === value && <span className="combo-check"><Icon name="check" /></span>}
                </div>
              </li>
            );
          })}
          {!shown.length && <li className="combo-empty">No match for “{q.trim()}”</li>}
          {total > MAX_SHOWN && shown.length === MAX_SHOWN && <li className="combo-more">Showing {MAX_SHOWN} of {total.toLocaleString()} — keep typing to narrow</li>}
        </ul>
      )}
    </div>
  );
});

export default Combobox;
