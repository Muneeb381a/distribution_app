import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';
import { PLATFORM_PASSWORD } from './global-setup.mjs';

let t, admin;

async function call(method, path, body, headers = {}) {
  const res = await fetch(t.base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
}
const authed = (token, headers = {}) => ({
  get: (p) => call('GET', p, undefined, { authorization: `Bearer ${token}`, ...headers }),
  post: (p, b = {}) => call('POST', p, b, { authorization: `Bearer ${token}`, ...headers }),
  patch: (p, b) => call('PATCH', p, b, { authorization: `Bearer ${token}`, ...headers }),
  delete: (p, b) => call('DELETE', p, b ?? {}, { authorization: `Bearer ${token}`, ...headers }),
});

async function newTenant(extra = {}, headers = {}) {
  const r = ok(await admin.post('/platform/tenants', { name: uniq('Biz'), ...extra }));
  const login = await call('POST', '/auth/login', { username: 'owner', password: r.owner.password, business: r.tenant.code }, headers);
  return { ...r, login, api: login.body?.accessToken ? authed(login.body.accessToken, headers) : null };
}
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const ymd = (iso) => String(iso).slice(0, 10);

beforeAll(async () => {
  t = await boot();
  const r = await call('POST', '/platform/auth/login', { username: 'platform', password: PLATFORM_PASSWORD });
  admin = authed(r.body.accessToken);
});
afterAll(() => t.close());

describe('billing', () => {
  it('moves the end date forward when a payment is recorded, and can undo the latest one', async () => {
    const a = await newTenant({ status: 'ACTIVE', expiresAt: inDays(5), monthlyFee: 5000 });
    expect(Number(a.tenant.monthlyFee)).toBe(5000);
    const before = new Date(a.tenant.expiresAt);
    const p = ok(await admin.post(`/platform/tenants/${a.tenant.id}/payments`, { amount: 5000, method: 'JAZZCASH', months: 2, note: 'Nov + Dec' }));
    const expected = new Date(before); expected.setUTCMonth(expected.getUTCMonth() + 2);
    expect(Math.abs(new Date(p.expiresAt).getTime() - expected.getTime())).toBeLessThan(3 * 86_400_000);
    const list = ok(await admin.get(`/platform/tenants/${a.tenant.id}/payments`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ method: 'JAZZCASH', months: 2, note: 'Nov + Dec', createdByName: 'platform' });

    ok(await admin.post(`/platform/tenants/${a.tenant.id}/payments`, { amount: 5000, method: 'CASH' }));
    // only the newest payment can be undone
    expect((await admin.delete(`/platform/payments/${list[0].id}`)).status).toBe(400);
    const newest = ok(await admin.get(`/platform/tenants/${a.tenant.id}/payments`))[0];
    ok(await admin.delete(`/platform/payments/${newest.id}`));
    const d = ok(await admin.get(`/platform/tenants/${a.tenant.id}`));
    expect(ymd(d.tenant.expiresAt)).toBe(ymd(p.expiresAt));
    expect(d.history.some((h) => h.action === 'PAYMENT')).toBe(true);
  });

  it('starts counting from today when the business had already run out, and lets it back in', async () => {
    const a = await newTenant({ status: 'ACTIVE', expiresAt: inDays(1) });
    ok(await admin.patch(`/platform/tenants/${a.tenant.id}`, { expiresAt: inDays(-20) }));
    expect((await a.api.get('/customers')).status).toBe(403);
    ok(await admin.post(`/platform/tenants/${a.tenant.id}/payments`, { amount: 3000, method: 'BANK' }));
    expect((await a.api.get('/customers')).status).toBe(200);
    const d = ok(await admin.get(`/platform/tenants/${a.tenant.id}`));
    const days = (new Date(d.tenant.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(26);
    expect(days).toBeLessThan(32);
  });

  it('refuses a payment for the original business, and odd amounts', async () => {
    const main = ok(await admin.get('/platform/tenants')).find((x) => x.isMain);
    expect((await admin.post(`/platform/tenants/${main.id}/payments`, { amount: 100, method: 'CASH' })).status).toBe(400);
    const a = await newTenant();
    expect((await admin.post(`/platform/tenants/${a.tenant.id}/payments`, { amount: -5, method: 'CASH' })).status).toBe(400);
    expect((await admin.post(`/platform/tenants/${a.tenant.id}/payments`, { amount: 5, method: 'GOLD' })).status).toBe(400);
  });

  it('adds up what is coming in and lists who has run out or is about to', async () => {
    const paying = await newTenant({ status: 'ACTIVE', monthlyFee: 7000, expiresAt: inDays(40) });
    const soon = await newTenant({ status: 'ACTIVE', expiresAt: inDays(3), phone: '0300-1111111' });
    const late = await newTenant({ status: 'ACTIVE', expiresAt: inDays(-4) });
    ok(await admin.post(`/platform/tenants/${paying.tenant.id}/payments`, { amount: 7000, method: 'CASH' }));
    const s = ok(await admin.get('/platform/billing/summary'));
    expect(Number(s.mrr)).toBeGreaterThanOrEqual(7000);
    expect(Number(s.collectedThisMonth)).toBeGreaterThanOrEqual(7000);
    expect(s.months).toHaveLength(6);
    expect(s.dueSoon.some((x) => x.id === soon.tenant.id && x.phone === '0300-1111111')).toBe(true);
    expect(s.overdue.some((x) => x.id === late.tenant.id)).toBe(true);
    const all = ok(await admin.get('/platform/payments'));
    expect(all.rows.some((r) => r.tenantId === paying.tenant.id && r.tenantName === paying.tenant.name)).toBe(true);
    expect(Number(all.total)).toBeGreaterThanOrEqual(7000);
    expect(ok(await admin.get('/platform/tenants')).find((x) => x.id === paying.tenant.id).lastPaymentOn).toBeTruthy();
  });
});

describe('storage', () => {
  it('shows what each business takes against the database limit', async () => {
    const a = await newTenant();
    const s = ok(await admin.get('/platform/storage'));
    expect(s.usedBytes).toBeGreaterThan(0);
    expect(s.limitBytes).toBeGreaterThan(s.usedBytes);
    expect(s.perTenant.find((x) => x.tenantId === a.tenant.id).bytes).toBeGreaterThan(10_000);
  });
});

describe('security', () => {
  it('signs everyone out of a business, and they can sign in again', async () => {
    const a = await newTenant();
    expect((await a.api.get('/customers')).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1100));
    ok(await admin.post(`/platform/tenants/${a.tenant.id}/sign-out-all`));
    const out = await a.api.get('/customers');
    expect(out.status).toBe(401);
    expect(out.body.message).toMatch(/signed out/i);
    await new Promise((r) => setTimeout(r, 1100));
    const again = await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code });
    expect(again.status).toBe(201);
    expect((await authed(again.body.accessToken).get('/customers')).status).toBe(200);
  });

  it('blocks an address everywhere, and lets it back', async () => {
    const a = await newTenant();
    const ip = '198.51.100.55';
    const bad = { 'x-forwarded-for': ip };
    expect((await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code }, bad)).status).toBe(201);
    const blocked = ok(await admin.post('/platform/blocked-ips', { ip, reason: 'guessing passwords' }));
    const r = await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code }, bad);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('IP_BLOCKED');
    // other addresses are not affected, and the console is not reachable from it either
    expect((await a.api.get('/customers')).status).toBe(200);
    expect((await call('POST', '/platform/auth/login', { username: 'platform', password: PLATFORM_PASSWORD }, bad)).status).toBe(403);
    expect(ok(await admin.get('/platform/security')).blocked.some((b) => b.ip === ip)).toBe(true);
    ok(await admin.delete(`/platform/blocked-ips/${blocked.id}`));
    expect((await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code }, bad)).status).toBe(201);
  });

  it('will not block the address the admin is using, or nonsense', async () => {
    expect((await admin.post('/platform/blocked-ips', { ip: '127.0.0.1' })).status).toBe(400);
    expect((await admin.post('/platform/blocked-ips', { ip: 'not-an-ip' })).status).toBe(400);
  });

  it('points at addresses that keep failing and at businesses used from several countries', async () => {
    const a = await newTenant();
    const attacker = { 'x-forwarded-for': '203.0.113.99', 'x-vercel-ip-country': 'RU', 'x-vercel-ip-city': 'Moscow' };
    for (const u of ['admin', 'owner', 'root']) await call('POST', '/auth/login', { username: u, password: 'nope-nope', business: a.tenant.code }, attacker);
    for (const [ip, country] of [['39.1.1.1', 'PK'], ['94.1.1.1', 'AE']]) {
      const l = await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code }, { 'x-forwarded-for': ip, 'x-vercel-ip-country': country });
      ok(await authed(l.body.accessToken, { 'x-forwarded-for': ip, 'x-vercel-ip-country': country }).get('/customers'));
    }
    const s = ok(await admin.get('/platform/security'));
    const top = s.topIps.find((x) => x.ip === '203.0.113.99');
    expect(top).toMatchObject({ count: 3, country: 'RU', city: 'Moscow', blocked: false });
    expect(top.users.sort()).toEqual(['admin', 'owner', 'root']);
    expect(s.multiCountry.find((x) => x.tenantId === a.tenant.id).countries).toEqual(['AE', 'PK']);
    expect(ok(await admin.get(`/platform/tenants/${a.tenant.id}`)).countries.sort()).toEqual(['AE', 'PK']);
  });
});

describe('announcements', () => {
  it('shows a message to everyone, or to one business, only while it is on', async () => {
    const a = await newTenant();
    const b = await newTenant();
    const all = ok(await admin.post('/platform/announcements', { title: uniq('Maintenance tonight'), body: 'Back by 2 am', level: 'WARNING' }));
    const onlyA = ok(await admin.post('/platform/announcements', { title: uniq('Renewal due'), tenantId: a.tenant.id, level: 'CRITICAL' }));
    const old = ok(await admin.post('/platform/announcements', { title: uniq('Old news'), endsAt: inDays(-1) }));

    const seenA = ok(await a.api.get('/announcements')).map((x) => x.id);
    const seenB = ok(await b.api.get('/announcements')).map((x) => x.id);
    expect(seenA).toContain(all.id);
    expect(seenA).toContain(onlyA.id);
    expect(seenB).toContain(all.id);
    expect(seenB).not.toContain(onlyA.id);
    expect(seenA).not.toContain(old.id);

    const list = ok(await admin.get('/platform/announcements'));
    expect(list.find((x) => x.id === onlyA.id)).toMatchObject({ tenantName: a.tenant.name, live: true, level: 'CRITICAL' });
    expect(list.find((x) => x.id === old.id).live).toBe(false);

    ok(await admin.patch(`/platform/announcements/${all.id}`, { isActive: false }));
    expect(ok(await a.api.get('/announcements')).map((x) => x.id)).not.toContain(all.id);
    ok(await admin.delete(`/platform/announcements/${onlyA.id}`));
    expect(ok(await a.api.get('/announcements')).map((x) => x.id)).not.toContain(onlyA.id);
  });

  it('is not readable without signing in, and bad input is refused', async () => {
    expect((await call('GET', '/announcements')).status).toBe(401);
    expect((await admin.post('/platform/announcements', { title: 'x' })).status).toBe(400);
    expect((await admin.post('/platform/announcements', { title: 'Fine title', level: 'LOUD' })).status).toBe(400);
  });
});
