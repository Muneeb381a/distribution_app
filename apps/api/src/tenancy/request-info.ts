import { createHash } from 'node:crypto';
import type { Request } from 'express';

/** Where a request came from, as far as the host tells us. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  browser: string | null;
  os: string | null;
  device: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  fingerprint: string;
}

const header = (req: Request, name: string): string | null => {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || null;
};

function decode(s: string | null): string | null {
  if (!s) return null;
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The caller's address: the first one the host saw, not whatever a proxy chain added after it. */
export function clientIp(req: Request): string | null {
  const raw = header(req, 'x-vercel-forwarded-for') ?? header(req, 'x-forwarded-for')?.split(',')[0] ?? header(req, 'x-real-ip') ?? req.socket?.remoteAddress ?? null;
  const ip = raw?.trim().replace(/^::ffff:/, '') ?? null;
  return ip === '::1' ? '127.0.0.1' : ip;
}

/** Browser, system and kind of device from the User-Agent text. Good enough to tell a phone from a PC. */
export function parseUserAgent(ua: string | null): { browser: string | null; os: string | null; device: string | null } {
  if (!ua) return { browser: null, os: null, device: null };
  const pick = (rules: [RegExp, string][]) => {
    for (const [re, name] of rules) {
      const m = ua.match(re);
      if (m) return m[1] ? `${name} ${m[1].replace(/_/g, '.').split('.')[0]}` : name;
    }
    return null;
  };
  const browser = pick([
    [/Edg(?:e|A|iOS)?\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/(?:Chrome|CriOS)\/([\d.]+)/, 'Chrome'],
    [/(?:Firefox|FxiOS)\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
    [/curl\/([\d.]+)/, 'curl'],
    [/node|undici/i, 'Script'],
  ]);
  const os = pick([
    [/Windows NT 10/, 'Windows 10/11'],
    [/Windows NT ([\d.]+)/, 'Windows'],
    [/Android ([\d.]+)/, 'Android'],
    [/(?:iPhone|iPad|iPod).*OS ([\d_]+)/, 'iOS'],
    [/Mac OS X/, 'macOS'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
  ]);
  const device = /iPad|Tablet/i.test(ua) ? 'Tablet' : /Mobi|iPhone|Android.*Mobile/i.test(ua) ? 'Phone' : browser === 'curl' || browser === 'Script' ? 'Script' : 'Computer';
  return { browser, os, device };
}

export function clientInfo(req: Request): ClientInfo {
  const ip = clientIp(req);
  const userAgent = header(req, 'user-agent')?.slice(0, 400) ?? null;
  return {
    ip,
    userAgent,
    ...parseUserAgent(userAgent),
    country: header(req, 'x-vercel-ip-country'),
    region: decode(header(req, 'x-vercel-ip-country-region')),
    city: decode(header(req, 'x-vercel-ip-city')),
    fingerprint: createHash('sha1').update(`${ip ?? ''}|${userAgent ?? ''}`).digest('hex').slice(0, 20),
  };
}
