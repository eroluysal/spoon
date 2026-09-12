import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, mock, json, stock } from './helpers.js';

test('inventory groups batches per bundle with catalogue metadata', async () => {
  const app = await createApp();
  await stock(app, 'esim_1GB_7D_GB_V2', 10);
  await stock(app, 'esim_1GB_7D_GB_V2', 5);
  await stock(app, 'esim_ULTD_7D_TR_U', 2);

  const { bundles } = json(await api(app, { method: 'GET', url: '/inventory' }));
  assert.equal(bundles.length, 2);

  const fixed = bundles.find((bundle) => bundle.name === 'esim_1GB_7D_GB_V2');
  assert.equal(fixed.desc, 'eSIM, 1GB, 7 Days, United Kingdom, V2');
  assert.equal(fixed.data, 1000);
  assert.equal(fixed.duration, 7);
  assert.equal(fixed.durationUnit, 'day');
  assert.equal(fixed.unlimited, false);
  assert.deepEqual(fixed.countries, ['GB']);
  assert.equal(fixed.available.length, 2, 'one row per batch');
  assert.deepEqual(
    fixed.available.map((batch) => batch.remaining),
    [10, 5],
  );
  assert.match(fixed.available[0].expiry, /^\d{4}-\d{2}-\d{2}$/);

  const unlimited = bundles.find((bundle) => bundle.name === 'esim_ULTD_7D_TR_U');
  assert.equal(unlimited.unlimited, true);
});

test('applying a bundle draws stock down', async () => {
  const app = await createApp();
  const row = await stock(app, 'esim_1GB_7D_GB_V2', 2);

  await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { bundles: [{ name: 'esim_1GB_7D_GB_V2' }] },
  });

  const { bundles } = json(await api(app, { method: 'GET', url: '/inventory' }));
  const batch = bundles[0].available.find((entry) => entry.id === row.usageId);
  assert.equal(batch.remaining, 1);
  assert.equal(batch.total, 2);
});

test('unused inventory can be refunded to the balance', async () => {
  const app = await createApp();
  const row = await stock(app, 'esim_1GB_7D_GB_V2', 4);
  const before = json(await api(app, { method: 'GET', url: '/organisation' })).balance;

  const response = await api(app, {
    method: 'POST',
    url: '/inventory/refund',
    payload: { usageId: row.usageId, quantity: 3 },
  });

  assert.equal(response.statusCode, 200);
  assert.match(json(response).status, /refunded 3 bundles to balance/);

  const after = json(await api(app, { method: 'GET', url: '/organisation' })).balance;
  assert.equal(after, before + 3 * 2.28);

  const { bundles } = json(await api(app, { method: 'GET', url: '/inventory' }));
  assert.equal(bundles[0].available[0].remaining, 1);
});

test('a fully refunded batch disappears from inventory', async () => {
  const app = await createApp();
  const row = await stock(app, 'esim_1GB_7D_GB_V2', 2);

  await api(app, {
    method: 'POST',
    url: '/inventory/refund',
    payload: { usageId: row.usageId, quantity: 2 },
  });

  const { bundles } = json(await api(app, { method: 'GET', url: '/inventory' }));
  assert.deepEqual(bundles, []);
});

test('refund validation rejects unknown batches and oversized quantities', async () => {
  const app = await createApp();
  const row = await stock(app, 'esim_1GB_7D_GB_V2', 1);

  const unknown = await api(app, {
    method: 'POST',
    url: '/inventory/refund',
    payload: { usageId: 99, quantity: 1 },
  });
  assert.equal(unknown.statusCode, 400);
  assert.match(json(unknown).message, /No inventory found/);

  const tooMany = await api(app, {
    method: 'POST',
    url: '/inventory/refund',
    payload: { usageId: row.usageId, quantity: 5 },
  });
  assert.equal(tooMany.statusCode, 400);
  assert.match(json(tooMany).message, /only 1 remaining/);

  const missingFields = await api(app, { method: 'POST', url: '/inventory/refund', payload: {} });
  assert.equal(missingFields.statusCode, 400);
});

test('expired stock is no longer available to apply', async () => {
  const app = await createApp();
  await stock(app, 'esim_1GB_7D_GB_V2', 1);

  await mock(app, { method: 'POST', url: '/clock', payload: { days: 400 } });

  const response = await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { bundles: [{ name: 'esim_1GB_7D_GB_V2' }] },
  });
  assert.equal(response.statusCode, 400);
  assert.match(json(response).message, /No esim_1GB_7D_GB_V2 bundles available/);
});

test('the organisation reports balance, test credit and users', async () => {
  const app = await createApp();
  const org = json(await api(app, { method: 'GET', url: '/organisation' }));

  assert.equal(org.currency, 'USD');
  assert.equal(org.balance, 10000);
  assert.equal(org.testCredit, 500);
  assert.equal(org.apiKey, 'test-key');
  assert.ok(org.users.length >= 1);
  assert.ok(org.groups.includes('Standard Fixed Bundles'));
  assert.equal(org.lowBalanceThreshold, undefined, 'mock-only fields stay internal');
});

test('topping up credits the balance and returns a reference', async () => {
  const app = await createApp();

  const first = json(await api(app, { method: 'POST', url: '/organisation/balance?amount=1000' }));
  assert.equal(first.amount, 1000);
  assert.equal(first.balance, 11000);
  assert.ok(first.ref);

  const second = json(await api(app, { method: 'POST', url: '/organisation/balance', payload: { amount: 500 } }));
  assert.equal(second.balance, 11500);
  assert.notEqual(second.ref, first.ref);

  assert.equal((await api(app, { method: 'POST', url: '/organisation/balance' })).statusCode, 400);
  assert.equal(
    (await api(app, { method: 'POST', url: '/organisation/balance?amount=-5' })).statusCode,
    400,
  );
});
