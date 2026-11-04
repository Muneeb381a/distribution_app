import { useMemo, useSyncExternalStore } from 'react';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010';

export interface SessionUser {
  id: string;
  username: string;
  roleName: string;
  permissions: string[];
}

const TOKEN_KEY = 'dist.token';
const USER_KEY = 'dist.user';

export function saveSession(token: string, user: SessionUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Replace the stored user (role or permissions changed on the server). */
export function updateUser(user: SessionUser) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

function messageOf(body: unknown, fallback: string): string {
  const m = (body as { message?: string | string[] } | null)?.message;
  return Array.isArray(m) ? m.join(', ') : (m ?? fallback);
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    clearSession();
    // Full reload on purpose: drops all in-memory state of the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/login';
  }
  return res;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await request(path, json === undefined ? rest : { ...rest, body: JSON.stringify(json) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, messageOf(body, res.statusText), body);
  return body as T;
}

export async function download(path: string, filename: string) {
  const res = await request(path);
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

const noSubscribe = () => () => {};

/** The signed-in user from localStorage; null on the server and before sign-in. */
export function useUser(): SessionUser | null {
  const raw = useSyncExternalStore(noSubscribe, () => localStorage.getItem(USER_KEY), () => null);
  return useMemo(() => (raw ? (JSON.parse(raw) as SessionUser) : null), [raw]);
}

export const can = (user: SessionUser | null, permission: string) => !!user?.permissions.includes(permission);
