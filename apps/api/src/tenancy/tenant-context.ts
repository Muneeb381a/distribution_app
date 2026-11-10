import { AsyncLocalStorage } from 'node:async_hooks';

/** The business a request belongs to. Everything the request reads or writes goes to this business's schema. */
export interface TenantCtx {
  id: string;
  code: string;
  /** Database schema holding the business's data ("public" for the original business). */
  schema: string;
  maxUsers: number | null;
  /** Tokens issued before this time (ms) are no longer accepted; null = no cut-off. */
  sessionsValidFrom: number | null;
}

export const tenantStore = new AsyncLocalStorage<TenantCtx>();

export const MAIN_TENANT = 'main';

export const currentTenant = () => tenantStore.getStore();
