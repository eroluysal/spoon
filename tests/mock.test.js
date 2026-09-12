import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, mock, json, orderEsim } from './helpers.js';

test('the control plane reports health and state counts', async () => {
  const app = await createApp();
  await orderEsim(app);

  const health = json(await mock(app, { method: 'GET', url: '/health' }));
  assert.equal(health.status, 'ok');
  assert.equal(health.basePath, '/v2.5');

  const state = json(await mock(app, { method: 'GET', url: '/state' }));
  assert.equal(state.counts.esims, 1);
  assert.equal(state.counts.assignments, 1);
  assert.equal(state.counts.orders, 1);
  assert.ok(state.counts.catalogue > 1000);
});

test('reset clears everything and optionally reseeds', async () => {
  const app = await createApp();
  await orderEsim(app);

  const bare = json(await mock(app, { method: 'POST', url: '/reset', payload: { seed: false } }));
  assert.deepEqual(bare.seeded, { inventory: 0, esims: 0 });
  assert.equal(json(await api(app, { method: 'GET', url: '/esims' })).esims.length, 0);

  // Seeding is switched off for the test profile, so turn it on for this check.
  const { config } = await import('../src/config.js');
  config.seed.esims = 2;
  config.seed.inventory = true;
  try {
    const seeded = json(await mock(app, { method: 'POST', url: '/reset', payload: { seed: true } }));
    assert.equal(seeded.seeded.esims, 2);
    assert.ok(seeded.seeded.inventory > 0);
    assert.equal(json(await api(app, { method: 'GET', url: '/esims' })).esims.length, 2);
  } finally {
    config.seed.esims = 0;
    config.seed.inventory = false;
    await mock(app, { method: 'POST', url: '/reset', payload: { seed: false } });
  }
});

test('the virtual clock moves forward and back', async () => {
  const app = await createApp();

  const start = json(await mock(app, { method: 'GET', url: '/clock' }));
  assert.equal(start.offsetMs, 0);

  const moved = json(await mock(app, { method: 'POST', url: '/clock', payload: { days: 3, hours: 2 } }));
  assert.equal(moved.offsetMs, 3 * 86400000 + 2 * 3600000);

  const reset = json(await mock(app, { method: 'POST', url: '/clock', payload: { reset: true } }));
  assert.equal(reset.offsetMs, 0);

  const empty = await mock(app, { method: 'POST', url: '/clock', payload: {} });
  assert.equal(empty.statusCode, 400);
});

test('usage needs a bundle that can consume data', async () => {
  const app = await createApp();
  const { iccids } = json(await mock(app, { method: 'POST', url: '/esims', payload: { count: 1 } }));

  const noBundle = await mock(app, {
    method: 'POST',
    url: `/esims/${iccids[0]}/usage`,
    payload: { mb: 10 },
  });
  assert.equal(noBundle.statusCode, 400);
  assert.match(json(noBundle).message, /no bundle/);

  const noAmount = await mock(app, {
    method: 'POST',
    url: `/esims/${iccids[0]}/usage`,
    payload: {},
  });
  assert.equal(noAmount.statusCode, 400);
});

test('a failure rule can be armed for a fixed number of calls', async () => {
  const app = await createApp();

  const rule = json(
    await mock(app, {
      method: 'POST',
      url: '/failures',
      payload: { path: '/organisation', method: 'GET', status: 503, message: 'Processing', count: 2 },
    }),
  );
  assert.equal(rule.status, 503);
  assert.equal(rule.remaining, 2);

  const first = await api(app, { method: 'GET', url: '/organisation' });
  const second = await api(app, { method: 'GET', url: '/organisation' });
  const third = await api(app, { method: 'GET', url: '/organisation' });

  assert.equal(first.statusCode, 503);
  assert.deepEqual(json(first), { message: 'Processing' });
  assert.equal(second.statusCode, 503);
  assert.equal(third.statusCode, 200, 'the rule burns out after two calls');

  const untouched = await api(app, { method: 'GET', url: '/inventory' });
  assert.equal(untouched.statusCode, 200, 'other routes are unaffected');
});

test('failure rules match sub-paths, can target everything and can be cleared', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  await mock(app, { method: 'POST', url: '/failures', payload: { path: '/esims', status: 500 } });
  assert.equal((await api(app, { method: 'GET', url: '/esims' })).statusCode, 500);
  assert.equal((await api(app, { method: 'GET', url: `/esims/${iccid}` })).statusCode, 500);
  assert.equal((await api(app, { method: 'GET', url: '/organisation' })).statusCode, 200);

  const cleared = json(await mock(app, { method: 'DELETE', url: '/failures' }));
  assert.equal(cleared.removed, 1);
  assert.equal((await api(app, { method: 'GET', url: '/esims' })).statusCode, 200);

  const wildcard = json(
    await mock(app, { method: 'POST', url: '/failures', payload: { path: '*', status: 429, message: 'Rate limit exceeded' } }),
  );
  assert.equal((await api(app, { method: 'GET', url: '/organisation' })).statusCode, 429);

  const removed = json(await mock(app, { method: 'DELETE', url: `/failures/${wildcard.id}` }));
  assert.equal(removed.removed, 1);
  assert.equal((await api(app, { method: 'GET', url: '/organisation' })).statusCode, 200);
});

test('the organisation can be patched out of band', async () => {
  const app = await createApp();

  await mock(app, {
    method: 'PATCH',
    url: '/organisation',
    payload: { balance: 42.5, currency: 'EUR', name: 'Patched Co' },
  });

  const org = json(await api(app, { method: 'GET', url: '/organisation' }));
  assert.equal(org.balance, 42.5);
  assert.equal(org.currency, 'EUR');
  assert.equal(org.name, 'Patched Co');

  const forbiddenField = await mock(app, {
    method: 'PATCH',
    url: '/organisation',
    payload: { apiKey: 'stolen' },
  });
  assert.equal(forbiddenField.statusCode, 400);
});

test('the upstream OpenAPI document is served for reference', async () => {
  const app = await createApp();
  const response = await mock(app, { method: 'GET', url: '/openapi.yaml' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /yaml/);
  assert.match(response.body, /openapi: 3\.0\.1/);
  assert.match(response.body, /version: 2\.5\.0/);
});

test('a full state dump round-trips the important collections', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const dump = json(await mock(app, { method: 'GET', url: '/state/dump' }));
  assert.equal(dump.esims.length, 1);
  assert.equal(dump.esims[0].iccid, iccid);
  assert.equal(dump.assignments.length, 1);
  assert.equal(dump.orders.length, 1);
  assert.equal(dump.references.length, 1);
});
