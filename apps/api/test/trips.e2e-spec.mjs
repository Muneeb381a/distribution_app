import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('vehicle trips', () => {
  it('loads in the morning, sells on the route, settles stock and cash in the evening', async () => {
    const w = await stockedWorld(t.owner, 20); // 120 bottles in the godown
    const vehicle = ok(await t.owner.post('/locations', { name: uniq('Suzuki'), type: 'VEHICLE' }));
    const salesman = ok(await t.owner.post('/employees', { name: uniq('Rafiq'), type: 'MONTHLY', monthlySalary: 30000 }));
    const c = ok(await t.owner.post('/customers', { name: uniq('Route shop'), type: 'CREDIT', creditLimit: 100000 }));

    const trip = ok(await t.owner.post('/trips', { vehicleId: vehicle.id, salesmanId: salesman.id, fromLocationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 10 }] }));
    expect(trip.status).toBe('OPEN');
    expect(Number(trip.lines[0].loaded)).toBe(60);
    expect((await t.owner.post('/trips', { vehicleId: vehicle.id })).status).toBe(409); // one open trip per vehicle
    expect((await t.owner.post('/trips', { vehicleId: w.godown.id })).status).toBe(400); // must be a vehicle

    // two bills on the route: 3 cartons with 1000 cash, 2 cartons on udhaar
    ok(await t.owner.post('/sales', { saleType: 'DELIVERY', customerId: c.id, salesmanId: salesman.id, locationId: vehicle.id, paidNow: 1000, method: 'CASH', items: [{ productId: w.product.id, unitName: 'CARTON', qty: 3 }] }));
    ok(await t.owner.post('/sales', { saleType: 'DELIVERY', customerId: c.id, salesmanId: salesman.id, locationId: vehicle.id, paidNow: 0, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 2 }] }));
    ok(await t.owner.post(`/trips/${trip.id}/load`, { fromLocationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'BOTTLE', qty: 6 }] }));

    const live = ok(await t.owner.get(`/trips/${trip.id}`));
    expect(Number(live.lines[0].loaded)).toBe(66);
    expect(Number(live.lines[0].sold)).toBe(30);
    expect(Number(live.lines[0].expected)).toBe(36);
    expect(live.totals.bills).toBe(2);
    expect(Number(live.cash.expected)).toBe(1000);

    // counted 34 bottles (2 short), 900 cash handed over: 100 short, recorded as an advance
    expect((await t.owner.post(`/trips/${trip.id}/settle`, { lines: [], cashReceived: 900 })).status).toBe(400); // must count
    const done = ok(await t.owner.post(`/trips/${trip.id}/settle`, {
      lines: [{ productId: w.product.id, counted: 34 }], cashReceived: 900, unloadToLocationId: w.godown.id, shortageAsAdvance: true,
    }));
    expect(done.status).toBe('SETTLED');
    expect(Number(done.settledLines[0].diff)).toBe(-2);
    expect(Number(done.settledLines[0].unloaded)).toBe(34);
    expect(Number(done.cash.short)).toBe(100);
    expect(Number(done.advance.amount)).toBe(100);
    expect((await t.owner.post(`/trips/${trip.id}/settle`, { lines: [], cashReceived: 0 })).status).toBe(409);

    // vehicle is empty, godown got the 34 back: 120 - 60 - 6 + 34 = 88
    expect(await w.stockOf(vehicle.id)).toBe(0);
    expect(await w.stockOf(w.godown.id)).toBe(88);
    const owed = ok(await t.owner.get(`/employees/${salesman.id}/ledger`));
    expect(Number(owed.owed)).toBe(100);

    // a settled trip still reads the same, and a new trip can start
    const again = ok(await t.owner.get(`/trips/${trip.id}`));
    expect(Number(again.lines[0].expected)).toBe(36);
    ok(await t.owner.post('/trips', { vehicleId: vehicle.id }));
  });
});
