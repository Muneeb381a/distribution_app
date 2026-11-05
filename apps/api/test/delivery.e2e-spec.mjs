import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, stockedWorld, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('delivery straight from the godown', () => {
  it('bills from the godown, carried by a vehicle, tracked until the customer signs', async () => {
    const w = await stockedWorld(t.owner, 20); // 120 bottles in the godown
    const vehicle = ok(await t.owner.post('/locations', { name: uniq('Suzuki'), type: 'VEHICLE' }));
    const salesman = ok(await t.owner.post('/employees', { name: uniq('Rafiq'), type: 'MONTHLY', monthlySalary: 30000 }));
    const c = ok(await t.owner.post('/customers', { name: uniq('Far shop'), type: 'CREDIT', creditLimit: 100000 }));
    const bill = { saleType: 'DELIVERY', customerId: c.id, salesmanId: salesman.id, locationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 2 }] };

    // the carrying vehicle is required when the goods come from the godown, and must be a vehicle
    expect((await t.owner.post('/sales', bill)).status).toBe(400);
    expect((await t.owner.post('/sales', { ...bill, vehicleId: w.godown.id })).status).toBe(400);

    // no loading step: the godown stock goes down straight away
    const sale = ok(await t.owner.post('/sales', { ...bill, vehicleId: vehicle.id, paidNow: 500, method: 'CASH' }));
    expect(await w.stockOf(w.godown.id)).toBe(108);
    expect(await w.stockOf(vehicle.id)).toBe(0);

    const view = ok(await t.owner.get(`/sales/${sale.id}`));
    expect(view.deliveryStatus).toBe('PENDING');
    expect(view.vehicle.id).toBe(vehicle.id);

    // pending list, then the receiver's name closes it
    const pending = ok(await t.owner.get('/sales?delivery=PENDING'));
    expect(pending.some((x) => x.id === sale.id && x.vehicleName)).toBe(true);
    expect((await t.owner.post(`/sales/${sale.id}/deliver`, { receivedBy: '  ' })).status).toBe(400);
    const done = ok(await t.owner.post(`/sales/${sale.id}/deliver`, { receivedBy: 'Rashid' }));
    expect(done.deliveryStatus).toBe('DELIVERED');
    expect(done.receivedBy).toBe('Rashid');
    expect((await t.owner.post(`/sales/${sale.id}/deliver`, { receivedBy: 'Rashid' })).status).toBe(409);
    expect(ok(await t.owner.get('/sales?delivery=PENDING')).some((x) => x.id === sale.id)).toBe(false);

    // the vehicle's day includes the cash taken on this dispatch
    const trip = ok(await t.owner.post('/trips', { vehicleId: vehicle.id, salesmanId: salesman.id }));
    const second = ok(await t.owner.post('/sales', { ...bill, vehicleId: vehicle.id, paidNow: 700, method: 'CASH' }));
    const live = ok(await t.owner.get(`/trips/${trip.id}`));
    expect(live.totals.bills).toBe(1);
    expect(Number(live.cash.expected)).toBe(700);

    // a cancelled dispatch is no longer pending
    ok(await t.owner.post(`/sales/${second.id}/cancel`, {}));
    expect(ok(await t.owner.get('/sales?delivery=PENDING')).some((x) => x.id === second.id)).toBe(false);
    expect((await t.owner.post(`/sales/${second.id}/deliver`, { receivedBy: 'X' })).status).toBe(409);
  });

  it('a bill from a loaded vehicle keeps working and is not tracked as pending', async () => {
    const w = await stockedWorld(t.owner, 10);
    const vehicle = ok(await t.owner.post('/locations', { name: uniq('Van'), type: 'VEHICLE' }));
    const salesman = ok(await t.owner.post('/employees', { name: uniq('Imran'), type: 'MONTHLY', monthlySalary: 30000 }));
    const c = ok(await t.owner.post('/customers', { name: uniq('Route shop'), type: 'CREDIT', creditLimit: 100000 }));
    ok(await t.owner.post('/trips', { vehicleId: vehicle.id, salesmanId: salesman.id, fromLocationId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 5 }] }));
    const sale = ok(await t.owner.post('/sales', { saleType: 'DELIVERY', customerId: c.id, salesmanId: salesman.id, locationId: vehicle.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] }));
    const view = ok(await t.owner.get(`/sales/${sale.id}`));
    expect(view.deliveryStatus).toBeNull();
    expect(view.vehicle.id).toBe(vehicle.id);
    expect((await t.owner.post('/sales', { saleType: 'DELIVERY', customerId: c.id, salesmanId: salesman.id, locationId: vehicle.id, vehicleId: w.godown.id, items: [{ productId: w.product.id, unitName: 'CARTON', qty: 1 }] })).status).toBe(400);
  });
});
