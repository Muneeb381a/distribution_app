'use client';

import { createContext, useContext, useEffect } from 'react';

export const PageTitleCtx = createContext<(t: { path: string; title: string }) => void>(() => {});

/** Name the current page more precisely than the menu does, e.g. "Bill BTL-000011". Shown in the breadcrumb and browser tab. */
export function usePageTitle(title: string | null | undefined) {
  const set = useContext(PageTitleCtx);
  useEffect(() => {
    if (title) set({ path: window.location.pathname, title });
  }, [set, title]);
}
