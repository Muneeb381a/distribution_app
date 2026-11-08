import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';
import { OWNER_PASSWORD } from './global-setup.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

// a 1x1 PNG
const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('delivery proof photos', () => {
  it('keeps photos with a bill, serves them back, counts them in the list and removes them', async () => {
    const w = await stockedWorld(t.owner, 10);
    const c = ok(await t.owner.post('/customers', { name: uniq('Far shop'), type: 'CREDIT', creditLimit: 100000 }));
    const bill = ok(await t.owner.post('/sales', { saleType: 'COUNTER', customerId: c.id, locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] }));

    expect(ok(await t.owner.get(`/delivery-proofs?saleId=${bill.id}`))).toEqual([]);
    const a = ok(await t.owner.post('/delivery-proofs', { saleId: bill.id, image: PIC }));
    expect(a.bytes).toBeGreaterThan(20);
    const list = ok(await t.owner.get(`/delivery-proofs?saleId=${bill.id}`));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: a.id, mime: 'image/png', by: 'owner' });
    expect(ok(await t.owner.get('/sales')).find((s) => s.id === bill.id).proofCount).toBe(1);

    const img = await fetch(`${t.base}/delivery-proofs/${a.id}/image`, { headers: { Authorization: `Bearer ${(await t.login('owner', OWNER_PASSWORD)).body.accessToken}` } });
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await img.arrayBuffer()).length).toBe(a.bytes);

    ok(await t.owner.delete(`/delivery-proofs/${a.id}`));
    expect(ok(await t.owner.get(`/delivery-proofs?saleId=${bill.id}`))).toEqual([]);
  });

  it('takes a real-sized photo, and refuses what is not a small picture or goes over the limits', async () => {
    const w = await stockedWorld(t.owner, 10);
    const bill = ok(await t.owner.post('/sales', { saleType: 'COUNTER', locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] }));
    // about 300 kb: well over the old 100 kb request limit
    const big = `data:image/jpeg;base64,${Buffer.alloc(220_000, 7).toString('base64')}`;
    ok(await t.owner.post('/delivery-proofs', { saleId: bill.id, image: big }));
    expect((await t.owner.post('/delivery-proofs', { saleId: bill.id, image: 'https://evil.example/x.png' })).status).toBe(400);
    expect((await t.owner.post('/delivery-proofs', { saleId: bill.id, image: 'data:text/html;base64,PHNjcmlwdD4=' })).status).toBe(400);
    expect((await t.owner.post('/delivery-proofs', { saleId: '11111111-1111-4111-8111-111111111111', image: PIC })).status).toBe(404);
    for (let i = 0; i < 3; i++) ok(await t.owner.post('/delivery-proofs', { saleId: bill.id, image: PIC }));
    expect((await t.owner.post('/delivery-proofs', { saleId: bill.id, image: PIC })).status).toBe(400); // 4 per bill
    expect((await t.owner.get('/delivery-proofs')).status).toBe(400);
  });
});
