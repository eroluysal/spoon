import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, mock, json, stock, orderEsim } from './helpers.js';

test('GET /esims/qr/{reference} still returns a ZIP, flagged as deprecated', async () => {
  const app = await createApp();
  const { reference } = await orderEsim(app, 'esim_1GB_7D_GB_V2', 2);

  const response = await api(app, { method: 'GET', url: `/esims/qr/${reference}` });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/zip');
  assert.equal(response.headers.deprecation, 'true');
  assert.match(response.headers['content-disposition'], /\.zip"$/);
  assert.equal(response.rawPayload.subarray(0, 2).toString('latin1'), 'PK');
});

test('GET /esims/csv/{reference} still returns CSV', async () => {
  const app = await createApp();
  const { reference, iccid } = await orderEsim(app);

  const response = await api(app, { method: 'GET', url: `/esims/csv/${reference}` });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/csv/);
  assert.equal(response.headers.deprecation, 'true');
  assert.ok(response.body.includes(iccid));

  const withUrls = await api(app, {
    method: 'GET',
    url: `/esims/csv/${reference}?additionalFields=installUrl`,
  });
  assert.ok(withUrls.body.includes('Apple Install URL'));
  assert.ok(withUrls.body.includes('esimsetup.apple.com'));
});

test('POST /esims/{iccid}/bundles still applies a bundle', async () => {
  const app = await createApp();
  const { iccids } = json(await mock(app, { method: 'POST', url: '/esims', payload: { count: 1 } }));
  const [iccid] = iccids;
  await stock(app, 'esim_1GB_7D_GB_V2', 1);

  const response = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/bundles`,
    payload: { name: 'esim_1GB_7D_GB_V2' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.deprecation, 'true');
  assert.match(json(response).status, /applied to eSIM/);

  const { bundles } = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles` }));
  assert.equal(bundles[0].name, 'esim_1GB_7D_GB_V2');

  const missingName = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/bundles`,
    payload: {},
  });
  assert.equal(missingName.statusCode, 400);
});

test('the legacy /applications/{assignmentId} revoke still works', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  const { assignments } = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2` }),
  );

  const validated = await api(app, {
    method: 'DELETE',
    url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2/applications/${assignments[0].id}?type=validate`,
  });
  assert.equal(validated.statusCode, 200);
  assert.match(json(validated).status, /can be revoked/);

  const revoked = await api(app, {
    method: 'DELETE',
    url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2/applications/${assignments[0].id}`,
  });
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.headers.deprecation, 'true');

  const after = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/bundles/esim_1GB_7D_GB_V2` }),
  );
  assert.equal(after.assignments[0].bundleState, 'revoked');
});
