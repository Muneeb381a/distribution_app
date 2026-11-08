import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('backups', () => {
  it('shows the state of backups to someone allowed to change settings, and nobody else', async () => {
    const res = ok(await t.owner.get('/backups'));
    expect(Array.isArray(res.files)).toBe(true);
    expect(res.status).toMatchObject({ count: expect.any(Number), everyHours: 24, running: false });
    expect(ok(await t.owner.get('/backups/status')).auto).toBe(true);
    const role = ok(await t.owner.post('/roles', { name: uniq('Counter'), permissions: ['SALE_CREATE'] }));
    const username = uniq('till').replace(/\s/g, '');
    ok(await t.owner.post('/users', { username, password: 'counter-pass-1', roleId: role.id }));
    const till = (await t.login(username, 'counter-pass-1')).api;
    expect((await till.get('/backups')).status).toBe(403);
    expect((await till.post('/backups', {})).status).toBe(403);
  });

  it('only serves files that look like our backups', async () => {
    expect((await t.owner.get('/backups/passwd/download')).status).toBe(400);
    expect((await t.owner.get('/backups/..%2F..%2Fapps%2Fapi%2F.env/download')).status).toBe(400);
    expect((await t.owner.get('/backups/distribution-2000-01-01_0000.dump/download')).status).toBe(404);
  });
});
