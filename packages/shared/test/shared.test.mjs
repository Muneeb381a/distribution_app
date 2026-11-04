import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RuleError, chooseRate, checkOneLine, checkPayment, creditBlock, defaultPaid, checkSaleHead, checkHasLines,
  localDay, presetRange, addDays, money, rupees, formatQty, offlineNumber, OFFLINE_BILL_NO, OFFLINE_RECEIPT_NO,
  PERMISSIONS, PERMISSION_LABEL, DEFAULT_ROLES, methodLabel, lineLabel, dueStatus,
} from '../dist/index.js';

const throwsRule = (fn, re, status = 400) => assert.throws(fn, (e) => e instanceof RuleError && re.test(e.message) && e.status === status);

test('rate: fixed beats list, list is used when no fixed', () => {
  assert.equal(chooseRate({ productName: 'Coke', unitName: 'CARTON', fixed: '1300', list: '1350', canEditRate: false }), '1300');
  assert.equal(chooseRate({ productName: 'Coke', unitName: 'CARTON', fixed: null, list: '1350', canEditRate: false }), '1350');
});
test('rate: missing rate needs to be entered, or someone who can', () => {
  throwsRule(() => chooseRate({ productName: 'Coke', unitName: 'CARTON', canEditRate: true }), /enter one/);
  throwsRule(() => chooseRate({ productName: 'Coke', unitName: 'CARTON', canEditRate: false }), /ask someone/, 403);
});
test('rate: changing it needs RATE_EDIT, re-entering the same rate does not', () => {
  assert.equal(chooseRate({ productName: 'Coke', unitName: 'CARTON', list: '1350', entered: 1350, canEditRate: false }), 1350);
  throwsRule(() => chooseRate({ productName: 'Coke', unitName: 'CARTON', list: '1350', entered: 1200, canEditRate: false }), /not allowed to change/, 403);
  assert.equal(chooseRate({ productName: 'Coke', unitName: 'CARTON', list: '1350', entered: 1200, canEditRate: true }), 1200);
});
test('one business line per bill', () => {
  assert.equal(checkOneLine(['RICE', 'RICE']), 'RICE');
  throwsRule(() => checkOneLine(['RICE', 'BOTTLES']), /not both/);
});
test('paid defaults: cash and walk-in pay the bill, udhaar pays nothing, never negative', () => {
  assert.equal(defaultPaid(null, 500), 500);
  assert.equal(defaultPaid({ type: 'CASH' }, 500), 500);
  assert.equal(defaultPaid({ type: 'CREDIT' }, 500), 0);
  assert.equal(defaultPaid(null, -200), 0);
});
test('payment checks', () => {
  throwsRule(() => checkPayment({ hasCustomer: true, net: -100, paid: 50 }), /cannot also take payment/);
  throwsRule(() => checkPayment({ hasCustomer: false, net: 500, paid: 400 }), /paid in full/);
  checkPayment({ hasCustomer: true, net: 500, paid: 0 });
});
test('credit rules', () => {
  assert.equal(creditBlock({ customer: { type: 'CREDIT', creditLimit: '1000' }, net: 500, paid: 0, newBalance: 900 }), null);
  assert.match(creditBlock({ customer: { type: 'CREDIT', creditLimit: '1000' }, net: 500, paid: 0, newBalance: 1200 }), /^CREDIT_LIMIT_EXCEEDED: balance would be 1200 against a limit of 1000$/);
  assert.match(creditBlock({ customer: { type: 'CASH', creditLimit: null }, net: 500, paid: 100, newBalance: 400 }), /^CASH_CUSTOMER_UNPAID/);
  assert.equal(creditBlock({ customer: { type: 'CREDIT', creditLimit: null }, net: 500, paid: 0, newBalance: 99999 }), null);
  assert.equal(creditBlock({ customer: { type: 'CASH', creditLimit: null }, net: 500, paid: 500, newBalance: 0 }), null);
  assert.equal(creditBlock({ customer: null, net: 500, paid: 0, newBalance: 0 }), null);
});
test('sale head and lines', () => {
  throwsRule(() => checkSaleHead({ saleType: 'DELIVERY', customerId: 'c' }), /salesman/);
  throwsRule(() => checkSaleHead({ saleType: 'DELIVERY', salesmanId: 's' }), /customer/);
  checkSaleHead({ saleType: 'COUNTER' });
  throwsRule(() => checkHasLines(0, 0), /at least one/);
});
test('local day is the local calendar day, not the UTC one', () => {
  const d = new Date(2026, 10, 4, 1, 30); // 01:30 local
  assert.equal(localDay(d), '2026-11-04');
  assert.equal(localDay(addDays(d, -4)), '2026-10-31');
  assert.deepEqual(presetRange('lastMonth', d), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(presetRange('7d', d), ['2026-10-29', '2026-11-04']);
});
test('formats', () => {
  assert.equal(money('1350'), '1,350');
  assert.equal(money(95.256), '95.26');
  assert.equal(rupees(72450.4), '72,450');
  assert.equal(money(null), '0');
  assert.equal(formatQty(36, [{ unitName: 'CARTON', factorToBase: '6' }], 'BOTTLE'), '36 (6 ctn)');
  assert.equal(formatQty(40, [{ unitName: 'CARTON', factorToBase: '6' }], 'BOTTLE'), '40 (6 ctn + 4)');
  assert.equal(formatQty(50, [], 'KG'), '50 kg');
});
test('document numbers', () => {
  assert.equal(offlineNumber('BTL', 'D2', 14), 'BTL-D2-000014');
  assert.ok(OFFLINE_BILL_NO.test('RIC-D12-000001'));
  assert.ok(!OFFLINE_BILL_NO.test('BTL-000123'));
  assert.ok(OFFLINE_RECEIPT_NO.test('RCP-D1-000001'));
});
test('permissions: one list, every one labelled, owner has all', () => {
  assert.equal(PERMISSIONS.length, 17);
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  for (const p of PERMISSIONS) assert.ok(PERMISSION_LABEL[p]);
  assert.deepEqual([...DEFAULT_ROLES.Owner].sort(), [...PERMISSIONS].sort());
});
test('labels', () => {
  assert.equal(methodLabel('EASYPAISA'), 'Easypaisa');
  assert.equal(methodLabel('RAAST'), 'Raast');
  assert.equal(lineLabel(null), 'Shared');
  assert.deepEqual(dueStatus('ACTIVE', 1000, 400), { label: 'Udhaar 600', tone: 'amber' });
  assert.deepEqual(dueStatus('CANCELLED', 1000, 0), { label: 'Cancelled', tone: 'red' });
});

import { DRINK_CATALOG, DRINK_SIZE_PRESETS, defaultPack, drinkSpecs, riceSpecs, productKey, unitLabel, RICE_TREE } from '../dist/index.js';

test('catalog: every drink has sizes, large PET is 6 a peti, glass 250 ml is a returnable crate of 24', () => {
  for (const b of DRINK_CATALOG) {
    assert.ok(b.products.length && b.sizes.length, b.category.join('/'));
    for (const s of b.sizes) {
      if (s.kind === 'PET' && s.ml >= 1000) assert.equal(s.pack, 6, `${b.products[0]} ${s.size}`);
      if (s.kind === 'glass') { assert.equal(s.pack, 24); assert.ok(s.returnable); }
    }
  }
  assert.ok(DRINK_SIZE_PRESETS.some((s) => s.size === '2.25 L'));
});
test('catalog: default pack for typed sizes', () => {
  assert.deepEqual(defaultPack('1.5 L'), { pack: 6, returnable: false });
  assert.deepEqual(defaultPack('500ml'), { pack: 12, returnable: false });
  assert.deepEqual(defaultPack('250 ml glass'), { pack: 24, returnable: true });
  assert.equal(defaultPack('family pack'), null);
});
test('catalog: specs', () => {
  const coke = DRINK_CATALOG.find((b) => b.products[0] === 'Coca-Cola');
  const specs = drinkSpecs(coke, 'Coca-Cola', coke.sizes.filter((s) => s.size === '1.5 L' || s.returnable));
  assert.equal(specs.length, 2);
  assert.ok(specs.find((s) => s.size === '250 ml glass').returnableEmpty);
  const rice = riceSpecs('Basmati', 'Super Kernel', 'Sella', ['loose', 'bag25']);
  assert.deepEqual(rice.map((r) => [r.size, r.bagKg, r.isPacked]), [[null, 50, false], ['25 kg bag', 25, true]]);
  assert.deepEqual(rice[0].path, ['Basmati', 'Super Kernel', 'Sella']);
  assert.ok(RICE_TREE.Basmati['Super Kernel'].includes('Sella'));
  assert.equal(productKey(' Coke ', '1.5  L'), productKey('coke', '1.5 l'));
  assert.equal(unitLabel('CARTON'), 'peti');
});
