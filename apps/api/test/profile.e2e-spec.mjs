import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

// a 1x1 PNG
const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('own profile', () => {
  it('saves a name and picture, serves them back, and removes the picture', async () => {
    const saved = ok(await t.owner.patch('/auth/profile', { displayName: '  Muneeb Khan ', avatar: PIC }));
    expect(saved.displayName).toBe('Muneeb Khan');
    expect(saved.avatar).toBe(PIC);
    const me = ok(await t.owner.get('/auth/me'));
    expect(me.avatar).toBe(PIC);
    expect(me.permissions.length).toBeGreaterThan(0);
    const cleared = ok(await t.owner.patch('/auth/profile', { avatar: null }));
    expect(cleared.avatar).toBeNull();
    expect(cleared.displayName).toBe('Muneeb Khan');
  });

  it('rejects anything that is not a small picture', async () => {
    expect((await t.owner.patch('/auth/profile', { avatar: 'https://evil.example/x.png' })).status).toBe(400);
    expect((await t.owner.patch('/auth/profile', { avatar: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400);
    expect((await t.owner.patch('/auth/profile', { avatar: `data:image/png;base64,${'A'.repeat(95_000)}` })).status).toBe(400);
  });

  it('changes the password only with the current one', async () => {
    expect((await t.owner.post('/auth/password', { current: 'wrong-one', next: 'brand-new-pass' })).status).toBe(400);
    expect((await t.owner.post('/auth/password', { current: 'x', next: 'abc' })).status).toBe(400);
  });
});
