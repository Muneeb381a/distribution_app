import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';
import { OWNER_PASSWORD, PLATFORM_PASSWORD } from './global-setup.mjs';

let t, admin;
const phone = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-vercel-ip-country': 'PK', 'x-vercel-ip-city': 'Lahore' };

/** A raw call so headers (address, browser) can be set. */
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

async function newTenant(extra = {}) {
  const name = uniq('Ali Traders');
  const r = ok(await admin.post('/platform/tenants', { name, ...extra }));
  const login = await call('POST', '/auth/login', { username: 'owner', password: r.owner.password, business: r.tenant.code }, phone);
  return { ...r, login, api: login.body?.accessToken ? authed(login.body.accessToken, phone) : null };
}

beforeAll(async () => {
  t = await boot();
  const r = await call('POST', '/platform/auth/login', { username: 'platform', password: PLATFORM_PASSWORD });
  admin = authed(r.body.accessToken);
});
afterAll(() => t.close());

describe('platform sign-in', () => {
  it('lets the platform admin in and keeps everyone else out', async () => {
    expect((await call('POST', '/platform/auth/login', { username: 'platform', password: 'nope' })).status).toBe(401);
    expect((await call('GET', '/platform/tenants')).status).toBe(401);
    // a business owner's token is not a platform token
    expect((await t.owner.get('/platform/tenants')).status).toBe(401);
    expect((await admin.get('/platform/auth/me')).body.username).toBe('platform');
    // and a platform token does not open a business
    const token = (await call('POST', '/platform/auth/login', { username: 'platform', password: PLATFORM_PASSWORD })).body.accessToken;
    expect((await authed(token).get('/customers')).status).toBe(401);
  });
});

describe('businesses', () => {
  it('creates a business with its own owner and starting data', async () => {
    const a = await newTenant({ contactName: 'Ali', phone: '0300-1234567', maxUsers: 5 });
    expect(a.tenant.code).toMatch(/^ali-traders/);
    expect(a.owner.username).toBe('owner');
    expect(a.login.status).toBe(201);
    expect(a.login.body.accessToken).toBeTruthy();
    const locs = ok(await a.api.get('/locations'));
    expect(locs.map((l) => l.name).sort()).toEqual(['Main Godown', 'Shop']);
    expect(ok(await a.api.get('/expenses/categories'))).toContain('Rent');
    // the sign-in page of that business carries its own name
    expect(ok(await call('GET', `/settings/public?business=${a.tenant.code}`)).businessName).toBe(a.tenant.name);
    const list = ok(await admin.get('/platform/tenants'));
    expect(list.find((x) => x.id === a.tenant.id)).toMatchObject({ users: 1, status: 'TRIAL', blocked: null });
    expect(list.some((x) => x.isMain && x.code === 'main')).toBe(true);
  });

  it("keeps every business's data apart", async () => {
    const a = await newTenant();
    const b = await newTenant();
    const shop = uniq('Only in A');
    ok(await a.api.post('/customers', { name: shop, type: 'CASH' }));
    expect(ok(await a.api.get('/customers')).some((c) => c.name === shop)).toBe(true);
    expect(ok(await b.api.get('/customers')).some((c) => c.name === shop)).toBe(false);
    expect(ok(await t.owner.get('/customers')).some((c) => c.name === shop)).toBe(false);
    // the same username exists in each business with its own password; the code picks the business
    expect((await call('POST', '/auth/login', { username: 'owner', password: b.owner.password, business: a.tenant.code })).status).toBe(401);
    expect((await call('POST', '/auth/login', { username: 'owner', password: OWNER_PASSWORD })).status).toBe(201);
    expect((await call('POST', '/auth/login', { username: 'owner', password: OWNER_PASSWORD, business: a.tenant.code })).status).toBe(401);
    expect((await call('POST', '/auth/login', { username: 'owner', password: OWNER_PASSWORD, business: 'no-such-shop' })).body.message).toMatch(/business code/i);
    // a token only works in its own business, even if another code is asked for
    const sneaky = await call('GET', `/customers?business=${b.tenant.code}`, undefined, { authorization: `Bearer ${a.login.body.accessToken}` });
    expect(ok(sneaky).some((c) => c.name === shop)).toBe(true);
  });

  it("keeps a business out of the whole-database backups", async () => {
    const a = await newTenant();
    expect(ok(await a.api.get('/backups/status')).supported).toBe(false);
    expect(ok(await a.api.get('/backups')).files).toEqual([]);
  });

  it('refuses codes that are reserved or already used', async () => {
    expect((await admin.post('/platform/tenants', { name: 'Admin Co', code: 'admin' })).status).toBe(400);
    const a = await newTenant();
    const dup = await admin.post('/platform/tenants', { name: 'Same code', code: a.tenant.code });
    expect(dup.status).toBe(409);
    expect((await admin.post('/platform/tenants', { name: 'Bad code', code: 'Has Spaces' })).status).toBe(400);
  });

  it('suspends and reactivates, and a suspended business is shut at once', async () => {
    const a = await newTenant();
    ok(await admin.post(`/platform/tenants/${a.tenant.id}/suspend`, { reason: 'Unpaid' }));
    const blocked = await a.api.get('/customers');
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ code: 'TENANT_BLOCKED' });
    expect(blocked.body.message).toMatch(/Unpaid/);
    expect((await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code })).status).toBe(403);
    ok(await admin.post(`/platform/tenants/${a.tenant.id}/activate`));
    expect((await a.api.get('/customers')).status).toBe(200);
  });

  it('stops a business whose end date has passed', async () => {
    const a = await newTenant();
    ok(await admin.patch(`/platform/tenants/${a.tenant.id}`, { expiresAt: new Date(Date.now() - 86_400_000).toISOString() }));
    expect((await a.api.get('/customers')).status).toBe(403);
    ok(await admin.patch(`/platform/tenants/${a.tenant.id}`, { expiresAt: '' }));
    expect((await a.api.get('/customers')).status).toBe(200);
  });

  it('holds a business to the number of users its plan allows', async () => {
    const a = await newTenant({ maxUsers: 2 });
    const role = ok(await a.api.get('/roles'))[0];
    ok(await a.api.post('/users', { username: 'second', password: 'secret-123', roleId: role.id }));
    const third = await a.api.post('/users', { username: 'third', password: 'secret-123', roleId: role.id });
    expect(third.status).toBe(400);
    expect(JSON.stringify(third.body)).toMatch(/allows 2/);
    ok(await admin.patch(`/platform/tenants/${a.tenant.id}`, { maxUsers: 0 }));
    ok(await a.api.post('/users', { username: 'third', password: 'secret-123', roleId: role.id }));
  });

  it('resets the owner password for someone locked out', async () => {
    const a = await newTenant();
    const r = ok(await admin.post(`/platform/tenants/${a.tenant.id}/reset-owner`, {}));
    expect(r.username).toBe('owner');
    expect((await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code })).status).toBe(401);
    expect((await call('POST', '/auth/login', { username: 'owner', password: r.password, business: a.tenant.code })).status).toBe(201);
  });

  it('deletes a business only when its code is typed, and takes its data with it', async () => {
    const a = await newTenant();
    expect((await admin.delete(`/platform/tenants/${a.tenant.id}`, { confirm: 'wrong' })).status).toBe(400);
    ok(await admin.delete(`/platform/tenants/${a.tenant.id}`, { confirm: a.tenant.code }));
    expect((await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code })).status).toBe(401);
    expect(ok(await admin.get('/platform/tenants')).some((x) => x.id === a.tenant.id)).toBe(false);
    const main = ok(await admin.get('/platform/tenants')).find((x) => x.isMain);
    expect((await admin.delete(`/platform/tenants/${main.id}`, { confirm: 'main' })).status).toBe(403);
    expect((await admin.post(`/platform/tenants/${main.id}/suspend`, {})).status).toBe(400);
  });
});

describe('who uses it, and from where', () => {
  it('records each sign-in with address, place and device, wrong ones too', async () => {
    const a = await newTenant();
    await call('POST', '/auth/login', { username: 'owner', password: 'wrong-password', business: a.tenant.code }, phone);
    const d = ok(await admin.get(`/platform/tenants/${a.tenant.id}`));
    const good = d.logins.find((l) => l.success);
    const bad = d.logins.find((l) => !l.success);
    expect(good).toMatchObject({ ip: '203.0.113.7', country: 'PK', city: 'Lahore', device: 'Phone', os: 'Android 14', browser: 'Chrome 131', username: 'owner' });
    expect(bad).toMatchObject({ reason: 'Wrong password', ip: '203.0.113.7' });
    const feed = ok(await admin.get(`/platform/logins?tenantId=${a.tenant.id}&result=failed`));
    expect(feed.rows).toHaveLength(1);
  });

  it('lists the people and devices seen working, and counts the requests', async () => {
    const a = await newTenant();
    for (let i = 0; i < 4; i++) ok(await a.api.get('/customers'));
    ok(await a.api.get('/products'));
    const d = ok(await admin.get(`/platform/tenants/${a.tenant.id}`));
    expect(d.sessions).toHaveLength(1);
    expect(d.sessions[0]).toMatchObject({ username: 'owner', ip: '203.0.113.7', device: 'Phone' });
    expect(d.tenant.activeNow).toBe(1);
    const today = d.usage[d.usage.length - 1];
    expect(today.requests).toBeGreaterThanOrEqual(4);
    expect(d.modules.find((m) => m.module === 'customers').requests).toBeGreaterThanOrEqual(4);
    expect(d.counts).toMatchObject({ users: 1, customers: 0 });
    expect(ok(await admin.get('/platform/sessions')).some((s) => s.tenantId === a.tenant.id)).toBe(true);
    const o = ok(await admin.get('/platform/overview'));
    expect(o.tenants.total).toBeGreaterThanOrEqual(2);
    expect(o.logins24h).toBeGreaterThan(0);
  });

  it('asks a person to wait after too many wrong passwords', async () => {
    const a = await newTenant();
    for (let i = 0; i < 8; i++) await call('POST', '/auth/login', { username: 'owner', password: `bad-${i}`, business: a.tenant.code }, { 'x-forwarded-for': `198.51.100.${i + 1}` });
    const r = await call('POST', '/auth/login', { username: 'owner', password: a.owner.password, business: a.tenant.code }, { 'x-forwarded-for': '198.51.100.99' });
    expect(r.status).toBe(429);
  });

  it('keeps a trail of what platform admins did', async () => {
    const a = await newTenant();
    ok(await admin.post(`/platform/tenants/${a.tenant.id}/suspend`, { reason: 'test' }));
    const trail = ok(await admin.get('/platform/audit'));
    expect(trail.some((e) => e.action === 'SUSPEND_TENANT' && e.tenantId === a.tenant.id && e.adminName === 'platform')).toBe(true);
  });
});

describe('platform admins', () => {
  it('adds another admin, turns it off, and changes a password', async () => {
    const username = `ops${Date.now().toString(36)}`;
    const created = ok(await admin.post('/platform/admins', { username, password: 'first-pass-1', displayName: 'Ops' }));
    const login = await call('POST', '/platform/auth/login', { username, password: 'first-pass-1' });
    expect(login.status).toBe(201);
    const me = authed(login.body.accessToken);
    expect((await me.post('/platform/auth/password', { current: 'wrong', next: 'second-pass-2' })).status).toBe(400);
    ok(await me.post('/platform/auth/password', { current: 'first-pass-1', next: 'second-pass-2' }));
    ok(await admin.patch(`/platform/admins/${created.id}`, { isActive: false }));
    expect((await me.get('/platform/tenants')).status).toBe(401);
    expect((await call('POST', '/platform/auth/login', { username, password: 'second-pass-2' })).status).toBe(401);
  });
});
