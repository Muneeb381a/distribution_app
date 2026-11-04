import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('business settings', () => {
  it('starts with defaults, the owner saves them once, everyone reads them', async () => {
    const first = ok(await t.owner.get('/settings'));
    expect(first.thermalWidth).toBe(80);
    expect(first.businessName).toBeTruthy();

    const saved = ok(await t.owner.put('/settings', { businessName: '  Ali Traders ', address: 'Main Bazar, Okara', phone: '0300-1234567', thermalWidth: 58, footer: 'شکریہ، پھر تشریف لائیں' }));
    expect(saved).toMatchObject({ businessName: 'Ali Traders', address: 'Main Bazar, Okara', thermalWidth: 58 });
    expect((await t.owner.put('/settings', { thermalWidth: 72 })).status).toBe(400);
    expect((await t.owner.put('/settings', { address: 'x'.repeat(200) })).status).toBe(400);
    // an emptied name falls back instead of printing a blank header
    expect(ok(await t.owner.put('/settings', { businessName: '' })).businessName).toBe(first.businessName);
    ok(await t.owner.put('/settings', { businessName: 'Ali Traders' }));

    const role = ok(await t.owner.get('/roles')).find((r) => r.name === 'Salesman');
    const username = uniq('s').replace(/\s/g, '');
    ok(await t.owner.post('/users', { username, password: 'secret123', roleId: role.id }));
    const sm = (await t.login(username, 'secret123')).api;
    expect(ok(await sm.get('/settings'))).toMatchObject({ businessName: 'Ali Traders', phone: '0300-1234567', thermalWidth: 58 });
    expect((await sm.put('/settings', { businessName: 'Hacked' })).status).toBe(403);

    expect(ok(await t.as().get('/settings/public'))).toEqual({ businessName: 'Ali Traders', tagline: first.tagline });
    expect((await t.as().get('/settings')).status).toBe(401);
  });
});
