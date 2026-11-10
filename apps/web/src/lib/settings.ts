'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, withDefaults, type BusinessSettings } from '@dist/shared';
import { api } from '@/lib/api';
import { scoped } from '@/lib/tenantScope';

/**
 * Business details and print preferences, kept in memory and in localStorage so bills printed
 * offline still carry the right name, address and roll width. Loaded once after sign-in.
 */
const key = () => scoped('dist.settings');
const listeners = new Set<() => void>();
let current: BusinessSettings | null = null;
let loading: Promise<void> | null = null;

function cached(): BusinessSettings {
  if (current) return current;
  try {
    const raw = localStorage.getItem(key());
    current = withDefaults(raw ? JSON.parse(raw) : null);
  } catch {
    current = { ...DEFAULT_SETTINGS };
  }
  return current;
}

function publish(s: BusinessSettings) {
  current = s;
  try { localStorage.setItem(key(), JSON.stringify(s)); } catch { /* storage blocked: memory only */ }
  listeners.forEach((l) => l());
}

/** Fetches the latest settings; keeps the cached copy when offline. */
export function loadSettings(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = api<BusinessSettings>('/settings').then((s) => publish(withDefaults(s))).catch(() => {});
  return loading;
}

/** Call after saving on the Settings screen. */
export const settingsSaved = (s: BusinessSettings) => publish(withDefaults(s));

/** The current settings for code outside React (print rendering). */
export const getSettings = cached;

export function useSettings(): BusinessSettings {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    cached,
    () => DEFAULT_SETTINGS,
  );
}
