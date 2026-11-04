import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const newUser = async (roleName) => {
  const role = ok(await t.owner.get('/roles')).find((r) => r.name === roleName);
  const username = uniq('u').replace(/\s/g, '');
  const user = ok(await t.owner.post('/users', { username, password: 'secret123', roleId: role.id }));
  return { user, username, ...(await t.login(username, 'secret123')) };
};

describe('sign-in and permissions', () => {
  it('rejects a wrong password and requests without a token', async () => {
    expect((await t.as().post('/auth/login', { username: 'owner', password: 'nope' })).status).toBe(401);
    expect((await t.as().get('/customers')).status).toBe(401);
    expect((await t.as('garbage').get('/customers')).status).toBe(401);
  });

  it('checks permissions on the server, not just in the menu', async () => {
    const sm = await newUser('Salesman');
    expect((await sm.api.get('/customers')).status).toBe(200);
    expect((await sm.api.get('/reports/profit')).status).toBe(403);
    expect((await sm.api.get('/dashboard/summary')).status).toBe(403);
    expect((await sm.api.get('/users')).status).toBe(403);
    expect((await sm.api.post('/expenses', { category: 'Rent', amount: 10 })).status).toBe(403);
  });

  it('disabling a user locks them out immediately, even with a valid token', async () => {
    const u = await newUser('Cashier');
    expect((await u.api.get('/customers')).status).toBe(200);
    ok(await t.owner.patch(`/users/${u.user.id}`, { isActive: false }));
    expect((await u.api.get('/customers')).status).toBe(401);
    expect((await t.as().post('/auth/login', { username: u.username, password: 'secret123' })).status).toBe(401);
  });

  it('editing a role applies on the next request', async () => {
    const role = ok(await t.owner.post('/roles', { name: uniq('Viewer'), permissions: [] }));
    const username = uniq('v').replace(/\s/g, '');
    ok(await t.owner.post('/users', { username, password: 'secret123', roleId: role.id }));
    const v = (await t.login(username, 'secret123')).api;
    expect((await v.get('/dashboard/summary')).status).toBe(403);
    ok(await t.owner.patch(`/roles/${role.id}`, { name: role.name, permissions: ['REPORT_VIEW'] }));
    expect((await v.get('/dashboard/summary')).status).toBe(200);
  });

  it('the Owner role cannot be edited, so nobody can lock the owner out', async () => {
    const owner = ok(await t.owner.get('/roles')).find((r) => r.name === 'Owner');
    expect((await t.owner.patch(`/roles/${owner.id}`, { name: 'Owner', permissions: [] })).status).toBe(400);
  });

  it('global search finds customers and honours bill permissions', async () => {
    const name = uniq('Searchable');
    ok(await t.owner.post('/customers', { name, type: 'CASH' }));
    const hits = ok(await t.owner.get(`/search?q=${encodeURIComponent(name.slice(0, 10))}`));
    expect(hits.some((h) => h.group === 'Customers' && h.title === name)).toBe(true);
    expect(ok(await t.owner.get('/search?q=a'))).toEqual([]); // under 2 characters
  });
});
