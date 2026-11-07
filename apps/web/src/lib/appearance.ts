'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { LOOK_KEY } from './lookBoot';

/**
 * How the app looks on this computer: accent colour, sidebar colour, card style and tab style.
 * Saved in localStorage together with the values worked out from it, so the page can be painted
 * correctly before React loads (see LOOK_BOOT in the root layout).
 */
export type CardStyle = 'soft' | 'outline' | 'raised' | 'tinted';
export type TabStyle = 'underline' | 'pill' | 'boxed';
export type FillStyle = 'gradient' | 'solid';
export interface Look { accent: string | null; side: string | null; fill: FillStyle; card: CardStyle; tabs: TabStyle }

export const DEFAULT_LOOK: Look = { accent: null, side: null, fill: 'gradient', card: 'soft', tabs: 'underline' };

export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Blue', hex: '#2563eb' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Violet', hex: '#7c3aed' },
  { name: 'Rose', hex: '#e11d48' },
  { name: 'Orange', hex: '#ea580c' },
  { name: 'Green', hex: '#15803d' },
  { name: 'Slate', hex: '#475569' },
];

export const SIDES: { name: string; hex: string }[] = [
  { name: 'Clean', hex: '#f3f5f8' },
  { name: 'Indigo', hex: '#3b3bb8' },
  { name: 'Royal blue', hex: '#1d4fd8' },
  { name: 'Ocean', hex: '#0b6bb5' },
  { name: 'Teal', hex: '#0d7a78' },
  { name: 'Emerald', hex: '#0a7d52' },
  { name: 'Violet', hex: '#6d33d6' },
  { name: 'Plum', hex: '#9b2c8f' },
  { name: 'Rose', hex: '#c2185b' },
  { name: 'Ember', hex: '#c2410c' },
  { name: 'Slate', hex: '#334155' },
  { name: 'Sky', hex: '#dbeafe' },
  { name: 'Mint', hex: '#d1fae5' },
];

export const FILLS: { id: FillStyle; name: string; hint: string }[] = [
  { id: 'gradient', name: 'Gradient', hint: 'Soft blend of two shades' },
  { id: 'solid', name: 'Solid', hint: 'One flat colour, no blend' },
];

export const CARDS: { id: CardStyle; name: string; hint: string }[] = [
  { id: 'soft', name: 'Soft', hint: 'Light shadow' },
  { id: 'outline', name: 'Outline', hint: 'Flat, clear border' },
  { id: 'raised', name: 'Raised', hint: 'Floating, deeper shadow' },
  { id: 'tinted', name: 'Tinted', hint: 'Touch of your colour' },
];

export const TABS: { id: TabStyle; name: string; hint: string }[] = [
  { id: 'underline', name: 'Underline', hint: 'Line under the open tab' },
  { id: 'pill', name: 'Pills', hint: 'Rounded, filled tab' },
  { id: 'boxed', name: 'Boxed', hint: 'Segmented switch' },
];

const KEY = LOOK_KEY;
const HEX = /^#[0-9a-f]{6}$/i;
const ATTRS = ['data-card', 'data-tabs', 'data-fill', 'data-accent', 'data-side-tone'];
const VARS = ['--brand', '--on-brand', '--side', '--side-accent'];
const listeners = new Set<() => void>();

/** Perceived brightness 0..1 of a #rrggbb colour. */
function lightness(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Mix a colour towards white by `t` (0..1). */
function lighten(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const m = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  return `#${m((n >> 16) & 255)}${m((n >> 8) & 255)}${m(n & 255)}`;
}

function bundle(look: Look) {
  const attrs: Record<string, string> = { 'data-card': look.card, 'data-tabs': look.tabs, 'data-fill': look.fill };
  const vars: Record<string, string> = {};
  if (look.accent) {
    attrs['data-accent'] = '1';
    vars['--brand'] = look.accent;
    vars['--on-brand'] = lightness(look.accent) > 0.62 ? '#10201c' : '#ffffff';
  }
  if (look.side) {
    vars['--side'] = look.side;
    attrs['data-side-tone'] = lightness(look.side) > 0.6 ? 'light' : 'dark';
  } else {
    attrs['data-side-tone'] = 'dark'; // the default Ink sidebar
  }
  const lightSide = !!look.side && lightness(look.side) > 0.6;
  if (look.accent) vars['--side-accent'] = lightSide ? look.accent : lighten(look.accent, 0.4);
  else if (lightSide) vars['--side-accent'] = '#0f766e';
  return { look, attrs, vars };
}

function paint(b: ReturnType<typeof bundle>) {
  const root = document.documentElement;
  ATTRS.forEach((a) => root.removeAttribute(a));
  VARS.forEach((v) => root.style.removeProperty(v));
  Object.entries(b.attrs).forEach(([k, v]) => root.setAttribute(k, v));
  Object.entries(b.vars).forEach(([k, v]) => root.style.setProperty(k, v));
}

function readRaw(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function parse(raw: string | null): Look {
  try {
    const l = (raw ? JSON.parse(raw) : {}).look ?? {};
    return {
      accent: HEX.test(l.accent) ? l.accent : null,
      side: HEX.test(l.side) ? l.side : null,
      fill: FILLS.some((x) => x.id === l.fill) ? l.fill : DEFAULT_LOOK.fill,
      card: CARDS.some((c) => c.id === l.card) ? l.card : DEFAULT_LOOK.card,
      tabs: TABS.some((t) => t.id === l.tabs) ? l.tabs : DEFAULT_LOOK.tabs,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

export function setLook(patch: Partial<Look>) {
  const next = { ...parse(readRaw()), ...patch };
  const b = bundle(next);
  paint(b);
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage blocked: still applied for this page */ }
  listeners.forEach((l) => l());
}

export function resetLook() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  paint(bundle(DEFAULT_LOOK));
  listeners.forEach((l) => l());
}

export function useLook(): Look {
  const raw = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, readRaw, () => null);
  return useMemo(() => parse(raw), [raw]);
}
