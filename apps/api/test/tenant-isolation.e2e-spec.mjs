import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';
import { PrismaClient } from '@prisma/client';
import { PLATFORM_PASSWORD } from './global-setup.mjs';
import { testUrl } from './db-url.mjs';

let t, admin, A, B, mainId, mainBefore, aData;
const MARK = `LEAK${Date.now().toString(36)}`;

async function call(method, path, body, headers = {}) {
  const res = await fetch(t.base + path, { method, headers: { 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, headers: res.headers };
}
const authed = (token) => ({
  get: (p) => call('GET', p, undefined, { authorization: `Bearer ${token}` }),
  post: (p, b = {}) => call('POST', p, b, { authorization: `Bearer ${token}` }),
  put: (p, b) => call('PUT', p, b, { authorization: `Bearer ${token}` }),
  patch: (p, b) => call('PATCH', p, b, { authorization: `Bearer ${token}` }),
  delete: (p, b) => call('DELETE', p, b ?? {}, { authorization: `Bearer ${token}` }),
});
async function newTenant() {
  const r = ok(await admin.post('/platform/tenants', { name: uniq('Shop'), status: 'ACTIVE' }));
  const login = await call('POST', '/auth/login', { username: 'owner', password: r.owner.password, business: r.tenant.code });
  return { ...r, token: login.body.accessToken, api: authed(login.body.accessToken) };
}
const counts = async (id) => ok(await admin.get(`/platform/tenants/${id}`)).counts;

beforeAll(async () => {
  t = await boot();
  const r = await call('POST', '/platform/auth/login', { username: 'platform', password: PLATFORM_PASSWORD });
  admin = authed(r.body.accessToken);
  mainId = ok(await admin.get('/platform/tenants')).find((x) => x.isMain).id;
  mainBefore = await counts(mainId);
  A = await newTenant();
  B = await newTenant();

  // Business A gets a bit of everything.
  const w = await stockedWorld(A.api, 20);
  const customer = ok(await A.api.post('/customers', { name: `${MARK} customer`, type: 'CREDIT', creditLimit: 100000 }));
  const sale = ok(await A.api.post('/sales', { saleType: 'COUNTER', customerId: customer.id, locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] }));
  ok(await A.api.post('/expenses', { category: `${MARK} category`, amount: 777 }));
  const employee = ok(await A.api.post('/employees', { name: `${MARK} employee`, type: 'DAILY', dailyWage: 1500 }));
  const vehicle = ok(await A.api.post('/vehicles', { regNo: `LEA-${Math.floor(1000 + Math.random() * 8999)}`, vehicleKind: 'PICKUP', name: `${MARK} truck` }));
  aData = { w, customer, sale, employee, vehicle };
});
afterAll(() => t.close());

describe('where data lands', () => {
  it('writes only into the business that made the request', async () => {
    const a = await counts(A.tenant.id);
    expect(a).toMatchObject({ customers: 1, sales: 1, products: 1, suppliers: 1, employees: 1 });
    expect(a.expenses).toBe(1);
    expect(a.stockMoves).toBeGreaterThan(0);
    const b = await counts(B.tenant.id);
    expect(b).toMatchObject({ customers: 0, sales: 0, products: 0, suppliers: 0, employees: 0, expenses: 0, purchases: 0, stockMoves: 0 });
    // and the original business is exactly as it was
    expect(await counts(mainId)).toEqual(mainBefore);
  });
});

describe('what another business can read', () => {
  const LISTS = ['/customers', '/suppliers', '/products', '/sales', '/purchases', '/stock', '/expenses', '/expenses/categories', '/expense-categories', '/employees', '/employees/options', '/vehicles', '/locations', '/audit', '/khata/dues', '/trips', '/users', '/roles', '/holidays', '/cheques', '/stock/reorder', '/payroll/advances'];

  it.each([['another business', () => B.api], ['the original business', () => t.owner]])('shows %s nothing of A in any list', async (_n, who) => {
    let looked = 0;
    for (const path of LISTS) {
      const r = await who().get(path);
      if (r.status !== 200) continue;
      looked++;
      const text = JSON.stringify(r.body);
      expect(text, path).not.toContain(MARK);
      expect(text, path).not.toContain(aData.sale.id);
      expect(text, path).not.toContain(aData.customer.id);
      expect(text, path).not.toContain(aData.w.product.id);
    }
    expect(looked).toBeGreaterThan(12);
    const found = ok(await who().get(`/search?q=${MARK}`));
    expect(JSON.stringify(found)).not.toContain(MARK);
  });

  it('does show A its own data (so the checks above mean something)', async () => {
    expect(JSON.stringify(ok(await A.api.get('/customers')))).toContain(MARK);
    expect(JSON.stringify(ok(await A.api.get('/expenses')))).toContain(MARK);
    expect(JSON.stringify(ok(await A.api.get('/employees')))).toContain(MARK);
    expect(JSON.stringify(ok(await A.api.get(`/search?q=${MARK}`)))).toContain(MARK);
  });

  it('cannot reach, change or use A records by their ids', async () => {
    for (const who of [B.api, t.owner]) {
      expect((await who.get(`/sales/${aData.sale.id}`)).status).toBe(404);
      expect((await who.get(`/customers/${aData.customer.id}`)).status).toBe(404);
      expect((await who.patch(`/customers/${aData.customer.id}`, { name: 'hijacked' })).status).toBe(404);
      expect((await who.patch(`/vehicles/${aData.vehicle.id}`, { note: 'hijacked' })).status).toBe(404);
      expect((await who.patch(`/employees/${aData.employee.id}`, { name: 'hijacked' })).status).toBe(404);
      // a bill built from A's customer, product and godown does not go through
      const w = await stockedWorld(who, 5);
      const bill = await who.post('/sales', { saleType: 'COUNTER', customerId: aData.customer.id, locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] });
      expect(bill.status).toBeGreaterThanOrEqual(400);
      const bill2 = await who.post('/sales', { saleType: 'COUNTER', locationId: aData.w.godown.id, items: [{ productId: aData.w.product.id, unitName: 'CARTON', qty: 1 }] });
      expect(bill2.status).toBeGreaterThanOrEqual(400);
    }
    // nothing of A changed
    expect(ok(await A.api.get(`/customers/${aData.customer.id}`)).name).toBe(`${MARK} customer`);
    expect((await counts(A.tenant.id)).sales).toBe(1);
  });
});

describe('behind a connection pooler', () => {
  it('writes the schema name into every query, so no shared connection can mix businesses up', async () => {
    // The same settings production uses for Neon's pooled address.
    const u = new URL(testUrl());
    u.searchParams.set('schema', A.tenant.schemaName);
    u.searchParams.set('pgbouncer', 'true');
    u.searchParams.set('connection_limit', '1');
    const c = new PrismaClient({ datasourceUrl: u.toString(), log: [{ emit: 'event', level: 'query' }] });
    const queries = [];
    c.$on('query', (e) => queries.push(e.query));
    try {
      expect((await c.customer.findMany()).some((x) => x.name === `${MARK} customer`)).toBe(true);
      await c.$transaction(async (tx) => { await tx.sale.findMany({ include: { items: true } }); await tx.product.count(); await tx.expense.findMany(); });
      await c.sale.create({ data: { billNo: `ZZ-${Date.now()}`, saleType: 'COUNTER', locationId: aData.w.godown.id, customerId: null, gross: 0, net: 0, paidNow: 0, createdById: (await c.appUser.findFirst()).id } }).catch(() => {});
    } finally {
      await c.$disconnect();
    }
    await new Promise((r) => setTimeout(r, 300)); // query events arrive a moment after the call
    expect(queries.length, 'no query was logged').toBeGreaterThan(0);
    const tables = queries.filter((q) => /(FROM|INTO|UPDATE|JOIN)\s/i.test(q));
    expect(tables.length).toBeGreaterThan(3);
    for (const q of tables) {
      expect(q, q).toContain(`"${A.tenant.schemaName}"."`);
      expect(q, q).not.toContain('"public"."');
    }
  });
});

describe('many requests at once', () => {
  it('keeps two businesses apart while their requests interleave', async () => {
    const names = (who) => Array.from({ length: 12 }, (_, i) => `${who}-${MARK}-${i}`);
    const mine = { A: names('A'), B: names('B') };
    await Promise.all(Array.from({ length: 12 }, (_, i) => [
      A.api.post('/customers', { name: mine.A[i], type: 'CASH' }),
      B.api.post('/customers', { name: mine.B[i], type: 'CASH' }),
      t.owner.post('/customers', { name: `main-${MARK}-${i}`, type: 'CASH' }),
    ]).flat());
    const seen = async (who) => ok(await who.get('/customers')).map((c) => c.name).filter((n) => n.includes(MARK) && !n.endsWith('customer'));
    expect((await seen(A.api)).sort()).toEqual([...mine.A].sort());
    expect((await seen(B.api)).sort()).toEqual([...mine.B].sort());
    expect((await seen(t.owner)).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `main-${MARK}-${i}`).sort());
    expect((await counts(A.tenant.id)).customers).toBe(13);
    expect((await counts(B.tenant.id)).customers).toBe(12);
  });

  it('keeps bills (database transactions) in the right business under load', async () => {
    const wB = await stockedWorld(B.api, 30);
    const sell = (api, w) => api.post('/sales', { saleType: 'COUNTER', locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] });
    const results = await Promise.all(Array.from({ length: 8 }, () => [sell(A.api, aData.w), sell(B.api, wB)]).flat());
    for (const r of results) expect(r.status).toBeLessThan(300);
    expect((await counts(A.tenant.id)).sales).toBe(1 + 8);
    expect((await counts(B.tenant.id)).sales).toBe(8);
    const aBills = ok(await A.api.get('/sales')).map((s) => s.id);
    const bBills = ok(await B.api.get('/sales')).map((s) => s.id);
    expect(aBills.some((id) => bBills.includes(id))).toBe(false);
    // the original business got none of those 16 bills (its own 12 customers were made by the test above)
    const m = await counts(mainId);
    expect(m.sales).toBe(mainBefore.sales);
    expect(m.customers).toBe(mainBefore.customers + 12);
  });
});

describe('tokens, caches and guessing', () => {
  it('only works inside the business it was made for, even when told otherwise', async () => {
    for (const trick of [{ 'x-business': B.tenant.code }, { 'x-business': 'main' }]) {
      const r = await call('GET', '/customers', undefined, { authorization: `Bearer ${A.token}`, ...trick });
      expect(JSON.stringify(r.body)).toContain(MARK);
    }
    expect((await call('GET', `/customers?business=${B.tenant.code}`, undefined, { authorization: `Bearer ${A.token}` })).status).toBe(200);
    const asMain = await call('GET', '/customers', undefined, { authorization: `Bearer ${A.token}`, 'x-business': 'main' });
    expect(JSON.stringify(asMain.body)).not.toContain('main-');
  });

  it('stops working when the business is deleted', async () => {
    const c = await newTenant();
    expect((await c.api.get('/customers')).status).toBe(200);
    ok(await admin.delete(`/platform/tenants/${c.tenant.id}`, { confirm: c.tenant.code }));
    expect((await c.api.get('/customers')).status).toBe(401);
  });

  it('tells browsers and proxies never to keep an answer', async () => {
    const r = await call('GET', '/customers', undefined, { authorization: `Bearer ${A.token}` });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('vary')).toMatch(/Authorization/i);
    expect((await call('GET', '/settings/public')).headers.get('cache-control')).toBe('private, no-store');
  });

  it('slows down someone trying business codes one after another', async () => {
    const ip = { 'x-forwarded-for': '192.0.2.77' };
    let last;
    for (let i = 0; i < 32; i++) last = await call('POST', '/auth/login', { username: 'owner', password: 'x', business: `guess-${i}` }, ip);
    expect(last.status).toBe(429);
  });

  it('keeps whole-database backups for the owner of the original business only', async () => {
    const role = ok(await t.owner.post('/roles', { name: uniq('Manager'), permissions: ['SETTINGS_EDIT'] }));
    const username = `mgr${Date.now().toString(36)}`;
    ok(await t.owner.post('/users', { username, password: 'manager-pass-1', roleId: role.id }));
    const mgr = authed((await call('POST', '/auth/login', { username, password: 'manager-pass-1' })).body.accessToken);
    expect(ok(await mgr.get('/backups/status')).supported).toBe(false);
    expect(ok(await mgr.get('/backups')).files).toEqual([]);
    expect((await mgr.post('/backups')).status).toBe(403);
    expect((await mgr.get('/backups/anything-2026-01-01_0000.dump/download')).status).toBe(403);
    // a business owner cannot either
    expect((await A.api.post('/backups')).status).toBeGreaterThanOrEqual(400);
  });
});
