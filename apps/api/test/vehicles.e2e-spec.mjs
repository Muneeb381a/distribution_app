import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, ok, uniq } from './helpers.mjs';

let t;
beforeAll(async () => { t = await boot(); });
afterAll(() => t.close());

describe('vehicles', () => {
  it('adds a vehicle with plate, kind and driver, and names it from the kind and plate', async () => {
    const plate = `lea ${Math.floor(1000 + Math.random() * 8999)}`;
    const driver = ok(await t.owner.post('/employees', { name: uniq('Driver'), type: 'DAILY', dailyWage: 1500 }));
    const v = ok(await t.owner.post('/vehicles', { regNo: plate, vehicleKind: 'PICKUP', driverId: driver.id, note: 'Carries 120 bags' }));
    expect(v.regNo).toBe(plate.toUpperCase());
    expect(v.name).toBe(`Pickup ${plate.toUpperCase()}`);
    expect(v.type).toBe('VEHICLE');

    const row = ok(await t.owner.get('/vehicles')).find((x) => x.id === v.id);
    expect(row).toMatchObject({ vehicleKind: 'PICKUP', note: 'Carries 120 bags', onTrip: null, tripCount: 0 });
    expect(row.driver.id).toBe(driver.id);
    // it is a normal location too, so trips and stock can use it
    expect(ok(await t.owner.get('/locations')).some((l) => l.id === v.id && l.type === 'VEHICLE')).toBe(true);
  });

  it('refuses the same plate twice however it is written', async () => {
    const n = Math.floor(1000 + Math.random() * 8999);
    ok(await t.owner.post('/vehicles', { regNo: `ABC-${n}`, vehicleKind: 'TRUCK' }));
    const again = await t.owner.post('/vehicles', { regNo: `abc ${n}`, vehicleKind: 'VAN' });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(/already added/);
  });

  it('uses a nickname when given, edits details, and clears the driver', async () => {
    const driver = ok(await t.owner.post('/employees', { name: uniq('Driver'), type: 'DAILY', dailyWage: 1500 }));
    const nick = uniq('Ali pickup');
    const v = ok(await t.owner.post('/vehicles', { regNo: `NK-${Math.floor(1000 + Math.random() * 8999)}`, vehicleKind: 'LOADER', name: nick, driverId: driver.id }));
    expect(v.name).toBe(nick);
    const edited = ok(await t.owner.patch(`/vehicles/${v.id}`, { vehicleKind: 'TRUCK', driverId: '', note: 'Sold in March' }));
    expect(edited).toMatchObject({ vehicleKind: 'TRUCK', driverId: null, note: 'Sold in March', name: nick });
  });

  it('shows a vehicle as on the road while a trip is open and will not deactivate it then', async () => {
    const v = ok(await t.owner.post('/vehicles', { regNo: `RD-${Math.floor(1000 + Math.random() * 8999)}`, vehicleKind: 'PICKUP' }));
    const trip = ok(await t.owner.post('/trips', { vehicleId: v.id }));
    const row = ok(await t.owner.get('/vehicles')).find((x) => x.id === v.id);
    expect(row.onTrip).toMatchObject({ id: trip.id, tripNo: trip.tripNo });
    expect(row.tripCount).toBe(1);
    const blocked = await t.owner.patch(`/vehicles/${v.id}`, { isActive: false });
    expect(blocked.status).toBe(409);
    ok(await t.owner.post(`/trips/${trip.id}/settle`, { lines: [], cashReceived: 0 }));
    ok(await t.owner.patch(`/vehicles/${v.id}`, { isActive: false }));
  });

  it('rejects an unknown driver, a blank plate, and a godown id', async () => {
    expect((await t.owner.post('/vehicles', { regNo: 'ZZ-1', vehicleKind: 'VAN', driverId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await t.owner.post('/vehicles', { regNo: '   ', vehicleKind: 'VAN' })).status).toBe(400);
    const godown = ok(await t.owner.post('/locations', { name: uniq('Godown'), type: 'GODOWN' }));
    expect((await t.owner.patch(`/vehicles/${godown.id}`, { note: 'x' })).status).toBe(404);
  });
});
