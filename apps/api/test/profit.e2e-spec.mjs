import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t, godown, bottlesCat, riceCat;
beforeAll(async () => {
  t = await boot();
  godown = ok(await t.owner.get('/locations')).find((l) => l.type === 'GODOWN');
  bottlesCat = ok(await t.owner.get('/categories?line=BOTTLES'))[0];
  riceCat = ok(await t.owner.get('/categories?line=RICE'))[0];
});
afterAll(() => t.close());

const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return day(d); };
const monthStart = () => { const d = new Date(); return day(new Date(d.getFullYear(), d.getMonth(), 1)); };

async function drink(pack = 6, rate = 125) {
  const p = ok(await t.owner.post('/products', { categoryId: bottlesCat.id, name: uniq('Profit cola'), size: '1.5 L', baseUnit: 'BOTTLE', units: [{ unitName: 'BOTTLE', factorToBase: 1 }, { unitName: 'CARTON', factorToBase: pack }] }));
  ok(await t.owner.put(`/product-prices/${p.id}`, { prices: [{ unitName: 'BOTTLE', rate }, { unitName: 'CARTON', rate: rate * pack }] }));
  return p;
}
async function rice(kgRate = 50) {
  const p = ok(await t.owner.post('/products', { categoryId: riceCat.id, name: uniq('Profit rice'), baseUnit: 'KG', units: [{ unitName: 'KG', factorToBase: 1 }, { unitName: 'MAUND', factorToBase: 40 }, { unitName: 'BAG', factorToBase: 50 }] }));
  ok(await t.owner.put(`/product-prices/${p.id}`, { prices: [{ unitName: 'KG', rate: kgRate }, { unitName: 'MAUND', rate: kgRate * 40 }, { unitName: 'BAG', rate: kgRate * 50 }] }));
  return p;
}
const buy = async (p, unitName, qty, unitPrice, date) => {
  const sup = ok(await t.owner.post('/suppliers', { name: uniq('Profit supplier') }));
  return ok(await t.owner.post('/purchases', { supplierId: sup.id, locationId: godown.id, date, items: [{ productId: p.id, unitName, qty, unitPrice }] }));
};
const sell = async (p, unitName, qty, rate) => ok(await t.owner.post('/sales', { saleType: 'COUNTER', locationId: godown.id, items: [{ productId: p.id, unitName, qty, ...(rate ? { rate } : {}) }] }));
const costOf = async (p) => Number(ok(await t.owner.get(`/stock?search=${encodeURIComponent(p.name)}`)).find((r) => r.productId === p.id)?.latestUnitCost ?? NaN);
/** Today's combined gross profit, net sales and cost. */
const today = async () => { const r = ok(await t.owner.get(`/reports/profit?from=${day()}&to=${day()}&groupBy=none`)); const x = r.rows[0]?.total; return { gross: Number(x?.grossProfit ?? 0), net: Number(x?.netSales ?? 0), cost: Number(x?.cost ?? 0), uncosted: r.rows[0]?.uncostedLines ?? 0 }; };

describe('how profit is worked out', () => {
  it('profit on a bottle sale is the sale less what the bottles cost, per bottle', async () => {
    const p = await drink();
    await buy(p, 'CARTON', 10, 600, day()); // 100 a bottle
    expect(await costOf(p)).toBe(100);
    const before = await today();
    await sell(p, 'CARTON', 2); // 12 bottles at 125
    const after = await today();
    expect(after.net - before.net).toBe(1500);
    expect(after.cost - before.cost).toBe(1200);
    expect(after.gross - before.gross).toBe(300);
    expect(after.uncosted).toBe(before.uncosted);
  });

  it('rice sold by the bag and by the kg is costed from the price paid per bag', async () => {
    const p = await rice(50);
    await buy(p, 'BAG', 20, 2000, day()); // 40 a kg
    expect(await costOf(p)).toBe(40);
    const before = await today();
    await sell(p, 'BAG', 2); // 100 kg at 50
    await sell(p, 'KG', 10); // 10 kg at 50
    await sell(p, 'MAUND', 1); // 40 kg at 50
    const after = await today();
    expect(after.net - before.net).toBe(5000 + 500 + 2000);
    expect(after.cost - before.cost).toBe(4000 + 400 + 1600);
    expect(after.gross - before.gross).toBe(1500);
  });

  it('a later purchase sets the cost for the next bills, and old bills keep the cost they had', async () => {
    const p = await drink();
    await buy(p, 'CARTON', 10, 600, day()); // 100 a bottle
    const first = await sell(p, 'CARTON', 1);
    await buy(p, 'CARTON', 10, 720, day()); // 120 a bottle
    expect(await costOf(p)).toBe(120);
    const second = await sell(p, 'CARTON', 1);
    const items = async (s) => ok(await t.owner.get(`/sales/${s.id}`)).items[0];
    expect(Number((await items(first)).unitCostBase)).toBe(100);
    expect(Number((await items(second)).unitCostBase)).toBe(120);
  });

  it('a purchase typed in late for an earlier day does not replace the newer price', async () => {
    const p = await drink();
    await buy(p, 'CARTON', 10, 720, day()); // today: 120 a bottle
    await buy(p, 'CARTON', 10, 480, daysAgo(20)); // an old bill typed in now: 80 a bottle
    expect(await costOf(p)).toBe(120);
    // an old purchase typed in first, then a newer one, still ends on the newer
    const q = await drink();
    await buy(q, 'CARTON', 10, 480, daysAgo(20));
    expect(await costOf(q)).toBe(80);
    await buy(q, 'CARTON', 10, 720, daysAgo(2));
    expect(await costOf(q)).toBe(120);
    // a product that has no cost yet still gets one from a backdated purchase
    const r = await drink();
    await buy(r, 'CARTON', 5, 540, daysAgo(40));
    expect(await costOf(r)).toBe(90);
  });

  it('the dashboard and the profit report give the same profit for the month', async () => {
    const p = await drink();
    await buy(p, 'CARTON', 10, 600, day());
    await sell(p, 'CARTON', 3);
    const report = ok(await t.owner.get(`/reports/profit?from=${monthStart()}&to=${day()}&groupBy=none`)).rows[0].total;
    const dash = ok(await t.owner.get('/dashboard/summary')).month;
    expect(Number(dash.netSales)).toBe(Number(report.netSales));
    expect(Number(dash.grossProfit)).toBe(Number(report.grossProfit));
    expect(Number(dash.netProfit)).toBe(Number(report.netProfit));
  });
});

describe('sales that have no cost', () => {
  it('are counted on the dashboard and the report, listed by product, and can be given a cost', async () => {
    const p = await drink();
    // stock with no cost: opening stock typed without one
    ok(await t.owner.post('/stock/opening', { locationId: godown.id, lines: [{ productId: p.id, qtyBase: 60 }] }));
    const dashBefore = ok(await t.owner.get('/dashboard/summary')).uncosted;
    const before = await today();
    await sell(p, 'CARTON', 2); // 12 bottles at 125 = 1500, no cost known
    const after = await today();
    // the whole sale shows up as profit, and that is flagged
    expect(after.gross - before.gross).toBe(1500);
    expect(after.uncosted).toBe(before.uncosted + 1);
    const dash = ok(await t.owner.get('/dashboard/summary')).uncosted;
    expect(dash.monthLines).toBe(dashBefore.monthLines + 1);
    expect(Number(dash.monthSales) - Number(dashBefore.monthSales)).toBe(1500);

    const list = ok(await t.owner.get('/reports/profit/uncosted'));
    const row = list.find((x) => x.productId === p.id);
    expect(row).toMatchObject({ lines: 1, cost: null, baseUnit: 'BOTTLE' });
    expect(Number(row.sales)).toBe(1500);
    expect(Number(row.qtyBase)).toBe(12);

    // typing the cost fixes the past line and sets the cost for new bills
    const fix = ok(await t.owner.post('/reports/profit/uncosted/fix', { items: [{ productId: p.id, unitCostBase: 90 }] }));
    expect(fix).toEqual({ products: 1, lines: 1 });
    const fixed = await today();
    expect(fixed.gross - before.gross).toBe(1500 - 12 * 90);
    expect(fixed.uncosted).toBe(before.uncosted);
    expect(ok(await t.owner.get('/reports/profit/uncosted')).some((x) => x.productId === p.id)).toBe(false);
    expect(await costOf(p)).toBe(90);
    await sell(p, 'BOTTLE', 6);
    const last = await today();
    expect(last.gross - fixed.gross).toBe(6 * 125 - 6 * 90);
  });

  it('only fills lines that have no cost, never changes one that has', async () => {
    const p = await drink();
    await buy(p, 'CARTON', 10, 600, day()); // 100 a bottle
    const costed = await sell(p, 'CARTON', 1);
    ok(await t.owner.post('/reports/profit/uncosted/fix', { items: [{ productId: p.id, unitCostBase: 50 }] }));
    expect(Number(ok(await t.owner.get(`/sales/${costed.id}`)).items[0].unitCostBase)).toBe(100);
  });

  it('needs the stock-adjust permission, and refuses a repeated or unknown product', async () => {
    const p = await drink();
    expect((await t.owner.post('/reports/profit/uncosted/fix', { items: [{ productId: p.id, unitCostBase: 5 }, { productId: p.id, unitCostBase: 6 }] })).status).toBe(400);
    expect((await t.owner.post('/reports/profit/uncosted/fix', { items: [{ productId: '00000000-0000-4000-8000-000000000000', unitCostBase: 5 }] })).status).toBe(400);
    expect((await t.owner.post('/reports/profit/uncosted/fix', { items: [{ productId: p.id, unitCostBase: 0 }] })).status).toBe(400);
    const cashier = ok(await t.owner.get('/roles')).find((r) => r.name === 'Cashier');
    const username = `cash${Date.now().toString(36)}`;
    ok(await t.owner.post('/users', { username, password: 'cashier-pass-1', roleId: cashier.id }));
    const c = (await t.login(username, 'cashier-pass-1')).api;
    expect((await c.post('/reports/profit/uncosted/fix', { items: [{ productId: p.id, unitCostBase: 5 }] })).status).toBe(403);
  });
});
