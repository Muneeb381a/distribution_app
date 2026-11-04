import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

const balanceOf = async (customerId) => Number(ok(await t.owner.get(`/khata/${customerId}`)).balance);

describe('cheques', () => {
  it('a customer cheque credits the khata now, can clear, or bounce and put the amount back', async () => {
    const c = ok(await t.owner.post('/customers', { name: uniq('Cheque shop'), type: 'CREDIT', openingBalance: 50000, creditLimit: 100000 }));
    expect(await balanceOf(c.id)).toBe(50000);

    expect((await t.owner.post('/payments', { customerId: c.id, amount: 1000, method: 'CHEQUE' })).status).toBe(400); // number needed
    expect((await t.owner.post('/payments', { customerId: c.id, amount: 1000, method: 'BITCOIN' })).status).toBe(400);

    const a = ok(await t.owner.post('/payments', { customerId: c.id, amount: 20000, method: 'CHEQUE', chequeNo: '000123', chequeBank: 'HBL', chequeDate: '2026-12-15' }));
    expect(a).toMatchObject({ method: 'CHEQUE', chequeNo: '000123', chequeBank: 'HBL', chequeStatus: 'PENDING' });
    expect(a.chequeDate.slice(0, 10)).toBe('2026-12-15');
    const b = ok(await t.owner.post('/payments', { customerId: c.id, amount: 10000, method: 'CHEQUE', chequeNo: '000124', chequeDate: '2026-11-20' }));
    expect(await balanceOf(c.id)).toBe(20000);

    const pending = ok(await t.owner.get('/cheques')).filter((p) => p.customerId === c.id);
    expect(pending.map((p) => p.chequeNo)).toEqual(['000124', '000123']); // soonest first

    ok(await t.owner.post(`/cheques/${b.id}/clear`, {}));
    expect((await t.owner.post(`/cheques/${b.id}/clear`, {})).status).toBe(409);
    expect((await t.owner.post(`/cheques/${b.id}/bounce`, {})).status).toBe(409);
    expect(await balanceOf(c.id)).toBe(20000);

    const bounced = ok(await t.owner.post(`/cheques/${a.id}/bounce`, { note: 'insufficient funds' }));
    expect(bounced).toMatchObject({ status: 'CANCELLED', chequeStatus: 'BOUNCED' });
    expect(await balanceOf(c.id)).toBe(40000);
    const ledger = ok(await t.owner.get(`/khata/${c.id}`));
    expect(ledger.entries.at(-1)).toMatchObject({ refType: 'CHEQUE_BOUNCED' });
    expect(ledger.entries.at(-1).note).toContain('000123');
    expect(ok(await t.owner.get('/cheques?status=BOUNCED')).some((p) => p.id === a.id)).toBe(true);
    expect(ok(await t.owner.get('/cheques?status=CLEARED')).some((p) => p.id === b.id)).toBe(true);
    // a bounced cheque's receipt cannot also be cancelled
    expect((await t.owner.post(`/payments/${a.id}/cancel`, {})).status).toBe(409);
  });

  it('cheques are not taken with a bill; suppliers can be paid by cheque', async () => {
    const w = await stockedWorld(t.owner, 5);
    const c = ok(await t.owner.post('/customers', { name: uniq('Walk'), type: 'CREDIT', creditLimit: 100000 }));
    const res = await t.owner.post('/sales', {
      saleType: 'COUNTER', customerId: c.id, locationId: w.godown.id, method: 'CHEQUE', paidNow: 100,
      items: [{ productId: w.product.id, unitName: 'BOTTLE', qty: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toEqual(['Take cheques as a payment on the khata, not with the bill']);

    expect((await t.owner.post('/supplier-payments', { supplierId: w.supplier.id, amount: 500, method: 'CHEQUE' })).status).toBe(400);
    const sp = ok(await t.owner.post('/supplier-payments', { supplierId: w.supplier.id, amount: 500, method: 'CHEQUE', chequeNo: 'MCB-55', chequeBank: 'MCB' }));
    expect(sp).toMatchObject({ chequeNo: 'MCB-55', chequeBank: 'MCB' });
    const led = ok(await t.owner.get(`/suppliers/${w.supplier.id}/ledger`));
    expect(led.entries.at(-1).note).toContain('cheque MCB-55');
  });
});

describe('customer statement', () => {
  it('brings the balance forward, lists the range with bill items, and closes on the khata balance', async () => {
    const w = await stockedWorld(t.owner, 10);
    const c = ok(await t.owner.post('/customers', { name: uniq('Statement shop'), type: 'CREDIT', openingBalance: 1000, creditLimit: 100000 }));
    ok(await t.owner.post('/payments', { customerId: c.id, amount: 400, date: '2026-09-10' }));
    const bill = ok(await t.owner.post('/sales', {
      saleType: 'COUNTER', customerId: c.id, locationId: w.godown.id, date: '2026-10-05', paidNow: 0,
      items: [{ productId: w.product.id, unitName: 'CARTON', qty: 2 }],
    }));
    ok(await t.owner.post('/payments', { customerId: c.id, amount: 500, method: 'EASYPAISA', date: '2026-10-20' }));

    const s = ok(await t.owner.get(`/khata/${c.id}/statement?from=2026-10-01&to=2026-10-31`));
    expect(Number(s.opening)).toBe(600); // 1000 opening - 400 paid in September
    expect(s.entries.map((e) => e.refType)).toEqual(['SALE', 'PAYMENT']);
    expect(s.entries[0].ref).toBe(bill.billNo);
    expect(s.entries[0].items[0]).toMatchObject({ unitName: 'CARTON' });
    expect(Number(s.entries[0].items[0].qty)).toBe(2);
    expect(s.entries[1].method).toBe('EASYPAISA');
    expect(Number(s.debit)).toBe(Number(bill.net));
    expect(Number(s.credit)).toBe(500);
    expect(Number(s.closing)).toBe(600 + Number(bill.net) - 500);
    expect(Number(s.closing)).toBe(Number(ok(await t.owner.get(`/khata/${c.id}`)).balance));
    expect((await t.owner.get(`/khata/${c.id}/statement?from=2026-10-31&to=2026-10-01`)).status).toBe(400);
  });
});
