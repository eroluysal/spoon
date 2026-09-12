import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, mock, json, stock, orderEsim } from './helpers.js';

test('applying a bundle needs stock in inventory', async () => {
  const app = await createApp();
  const { iccids } = json(await mock(app, { method: 'POST', url: '/esims', payload: { count: 1 } }));

  const withoutStock = await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { iccid: iccids[0], name: 'esim_1GB_7D_GB_V2' },
  });
  assert.equal(withoutStock.statusCode, 400);
  assert.match(json(withoutStock).message, /No esim_1GB_7D_GB_V2 bundles available/);

  await stock(app, 'esim_1GB_7D_GB_V2', 1);
  const applied = json(
    await api(app, {
      method: 'POST',
      url: '/esims/apply',
      payload: { iccid: iccids[0], name: 'esim_1GB_7D_GB_V2' },
    }),
  );
  assert.equal(applied.esims.length, 1);
  assert.equal(applied.esims[0].iccid, iccids[0]);
  assert.ok(applied.applyReference);
});

test('apply with repeat provisions new eSIMs and refuses to mix with an ICCID', async () => {
  const app = await createApp();
  await stock(app, 'esim_1GB_7D_GB_V2', 5);

  const applied = json(
    await api(app, {
      method: 'POST',
      url: '/esims/apply',
      payload: { bundles: [{ name: 'esim_1GB_7D_GB_V2', repeat: 3 }] },
    }),
  );
  assert.equal(applied.esims.length, 3);
  assert.equal(new Set(applied.esims.map((esim) => esim.iccid)).size, 3);

  const clash = await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { iccid: applied.esims[0].iccid, name: 'esim_1GB_7D_GB_V2', repeat: 2 },
  });
  assert.equal(clash.statusCode, 400);
  assert.match(json(clash).message, /repeat parameter cannot be combined/);
});

test('an assignment moves processing -> queued -> active and reports bytes', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const initial = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles` }));
  const [assignment] = initial.bundles[0].assignments;
  assert.equal(assignment.bundleState, 'processing');
  assert.equal(assignment.initialQuantity, 1_000_000_000, '1GB in base-10 bytes');
  assert.equal(assignment.remainingQuantity, 1_000_000_000);
  assert.equal(assignment.unlimited, false);
  assert.equal(assignment.callTypeGroup, 'data');
  assert.match(assignment.assignmentReference, /-0$/);
  assert.equal(assignment.startTime, undefined, 'not started yet');

  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  const queued = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles` }));
  assert.equal(queued.bundles[0].assignments[0].bundleState, 'queued');

  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  const active = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles` }));
  const started = active.bundles[0].assignments[0];
  assert.equal(started.bundleState, 'active');
  assert.ok(started.startTime);
  assert.ok(started.endTime);
  assert.equal(
    Math.round((Date.parse(started.endTime) - Date.parse(started.startTime)) / 86400000),
    7,
    'the validity window matches the bundle duration',
  );
});

test('usage depletes a bundle and starts the next queued one', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await stock(app, 'esim_5GB_30D_GB_V2', 1);
  await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { iccid, name: 'esim_5GB_30D_GB_V2', allowReassign: true },
  });

  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  const halfway = json(
    await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 600 } }),
  );
  assert.equal(halfway.bundleState, 'active');
  assert.equal(halfway.remainingQuantity, 400_000_000);

  const depleted = json(
    await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 400 } }),
  );
  assert.equal(depleted.bundleState, 'depleted');
  assert.equal(depleted.remainingQuantity, 0);

  const bundles = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles?includeUsed=true&limit=200` }),
  );
  const states = Object.fromEntries(
    bundles.bundles.map((bundle) => [bundle.name, bundle.assignments[0].bundleState]),
  );
  assert.equal(states.esim_1GB_7D_GB_V2, 'depleted');
  assert.equal(states.esim_5GB_30D_GB_V2, 'active', 'the queued bundle took over');
});

test('includeUsed and limit control the bundle list', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 1000 } });

  const live = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles` }));
  assert.equal(live.bundles.length, 0, 'depleted bundles are hidden by default');

  const used = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles?includeUsed=true` }));
  assert.equal(used.bundles.length, 1);

  const bad = await api(app, { method: 'GET', url: `/esims/${iccid}/bundles?limit=500` });
  assert.equal(bad.statusCode, 400);
});

test('bundle status can be queried by name', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const status = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2` }),
  );
  assert.equal(status.assignments.length, 1);
  assert.equal(status.assignments[0].bundleState, 'processing');

  const unknownBundle = await api(app, {
    method: 'GET',
    url: `/esims/${iccid}/bundles/esim_nope`,
  });
  assert.equal(unknownBundle.statusCode, 400);

  const empty = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles/esim_5GB_30D_GB_V2` }),
  );
  assert.deepEqual(empty, { assignments: [] });
});

test('an unused bundle is revoked back to inventory', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const validated = json(
    await api(app, {
      method: 'DELETE',
      url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2?type=validate`,
    }),
  );
  assert.match(validated.status, /will be refunded to inventory/);

  const stillThere = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2` }),
  );
  assert.equal(stillThere.assignments[0].bundleState, 'processing', 'validate changes nothing');

  const revoked = json(
    await api(app, { method: 'DELETE', url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2` }),
  );
  assert.equal(revoked.status, 'Successfully Revoked Bundle, bundle has been refunded to inventory');

  const { bundles } = json(await api(app, { method: 'GET', url: '/inventory' }));
  const row = bundles.find((bundle) => bundle.name === 'esim_1GB_7D_GB_V2');
  assert.ok(row.available.some((batch) => batch.remaining >= 1));
});

test('refundToBalance credits the organisation instead of inventory', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  const before = json(await api(app, { method: 'GET', url: '/organisation' })).balance;

  const revoked = json(
    await api(app, {
      method: 'DELETE',
      url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2?refundToBalance=true`,
    }),
  );
  assert.match(revoked.status, /refunded to balance/);

  const after = json(await api(app, { method: 'GET', url: '/organisation' })).balance;
  assert.equal(after, before + 2.28);
});

test('a partially used bundle is revoked without a refund', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 100 } });

  const before = json(await api(app, { method: 'GET', url: '/organisation' })).balance;
  const revoked = json(
    await api(app, {
      method: 'DELETE',
      url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2?refundToBalance=true`,
    }),
  );

  assert.equal(revoked.status, 'Successfully Revoked Bundle, no refund applicable');
  assert.equal(json(await api(app, { method: 'GET', url: '/organisation' })).balance, before);
});

test('a specific assignment can be revoked by id', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await stock(app, 'esim_1GB_7D_GB_V2', 1);
  await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { iccid, name: 'esim_1GB_7D_GB_V2' },
  });

  const { assignments } = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2` }),
  );
  assert.equal(assignments.length, 2);
  const target = assignments[1].id;

  const revoked = await api(app, {
    method: 'DELETE',
    url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2/assignments/${target}`,
  });
  assert.equal(revoked.statusCode, 200);

  const after = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2` }),
  );
  const revokedOne = after.assignments.find((assignment) => assignment.id === target);
  assert.equal(revokedOne.bundleState, 'revoked');
  assert.equal(after.assignments.filter((a) => a.bundleState === 'processing').length, 1);

  const twice = await api(app, {
    method: 'DELETE',
    url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2/assignments/${target}`,
  });
  assert.equal(twice.statusCode, 400);
  assert.match(json(twice).message, /revoked/);
});

test('revoking something that is not assigned is a 400', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const response = await api(app, {
    method: 'DELETE',
    url: `/esims/${iccid}/bundles/esim_5GB_30D_GB_V2`,
  });
  assert.equal(response.statusCode, 400);
  assert.match(json(response).message, /is not assigned/);
});

test('bundles expire when their window passes and lapse when never started', async () => {
  const app = await createApp();

  const { iccid } = await orderEsim(app);
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  await mock(app, { method: 'POST', url: '/clock', payload: { days: 8 } });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  const expired = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles?includeUsed=true` }),
  );
  assert.equal(expired.bundles[0].assignments[0].bundleState, 'expired');

  await stock(app, 'esim_5GB_30D_GB_V2', 1);
  const applied = json(
    await api(app, {
      method: 'POST',
      url: '/esims/apply',
      payload: { bundles: [{ name: 'esim_5GB_30D_GB_V2' }] },
    }),
  );
  const idle = applied.esims[0].iccid;

  await mock(app, { method: 'POST', url: '/clock', payload: { days: 400 } });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  const lapsed = json(
    await api(app, { method: 'GET', url: `/esims/${idle}/bundles?includeUsed=true` }),
  );
  assert.equal(lapsed.bundles[0].assignments[0].bundleState, 'lapsed');
});

test('an unlimited bundle never depletes', async () => {
  const app = await createApp();
  await stock(app, 'esim_ULTD_7D_GB_U', 1);
  const applied = json(
    await api(app, {
      method: 'POST',
      url: '/esims/apply',
      payload: { bundles: [{ name: 'esim_ULTD_7D_GB_U' }] },
    }),
  );
  const iccid = applied.esims[0].iccid;

  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  const usage = json(
    await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 50_000 } }),
  );

  assert.equal(usage.remainingQuantity, 0);
  assert.equal(usage.bundleState, 'active', 'unlimited bundles stay active at zero');

  const bundles = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles` }));
  assert.equal(bundles.bundles[0].assignments[0].unlimited, true);
});
