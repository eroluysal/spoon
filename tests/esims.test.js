import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, mock, json, stock, orderEsim } from './helpers.js';

test('eSIMs can be listed, paginated, filtered and ordered', async () => {
  const app = await createApp();
  await orderEsim(app, 'esim_1GB_7D_GB_V2', 3);

  const all = json(await api(app, { method: 'GET', url: '/esims?perPage=10' }));
  assert.equal(all.esims.length, 3);
  const [row] = all.esims;
  assert.ok(row.iccid);
  assert.equal(row.state, 'active');
  assert.equal(row.physical, false);
  assert.equal(row.lastAction, 'Bundle Applied');

  const paged = json(await api(app, { method: 'GET', url: '/esims?perPage=10&page=2' }));
  assert.equal(paged.esims.length, 0);

  await api(app, { method: 'PUT', url: `/esims?iccid=${row.iccid}&customerRef=NEEDLE` });
  const filtered = json(
    await api(app, { method: 'GET', url: '/esims?filterBy=customerRef&filter=needle' }),
  );
  assert.equal(filtered.esims.length, 1);
  assert.equal(filtered.esims[0].iccid, row.iccid);

  const ordered = json(await api(app, { method: 'GET', url: '/esims?orderBy=iccid&direction=asc' }));
  assert.deepEqual(
    ordered.esims.map((esim) => esim.iccid),
    [...ordered.esims.map((esim) => esim.iccid)].sort(),
  );
});

test('unsupported list parameters are rejected', async () => {
  const app = await createApp();

  assert.equal((await api(app, { method: 'GET', url: '/esims?perPage=7' })).statusCode, 400);
  assert.equal((await api(app, { method: 'GET', url: '/esims?filterBy=nope&filter=x' })).statusCode, 400);
  assert.equal((await api(app, { method: 'GET', url: '/esims?orderBy=msisdn' })).statusCode, 400);
});

test('eSIM details include profile data and optional install URLs', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const plain = json(await api(app, { method: 'GET', url: `/esims/${iccid}` }));
  assert.equal(plain.iccid, iccid);
  assert.equal(plain.profileStatus, 'Released');
  assert.equal(plain.state, 'active');
  assert.match(plain.pin, /^\d{4}$/);
  assert.match(plain.puk, /^\d{8}$/);
  assert.equal(plain.appleInstallUrl, undefined);

  const withUrls = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}?additionalFields=installUrl` }),
  );
  assert.match(withUrls.appleInstallUrl, /^https:\/\/esimsetup\.apple\.com/);
  assert.match(withUrls.androidInstallUrl, /^https:\/\/esimsetup\.android\.com/);
  assert.ok(withUrls.appleInstallUrl.includes(`LPA:1$${plain.smdpAddress}$${plain.matchingId}`));
});

test('an unknown or malformed ICCID is handled the way the live API does', async () => {
  const app = await createApp();

  const unknown = await api(app, { method: 'GET', url: '/esims/8943108199999999999' });
  assert.equal(unknown.statusCode, 403, 'another organisation ICCID is forbidden, not 404');

  const malformed = await api(app, { method: 'GET', url: '/esims/not-an-iccid' });
  assert.equal(malformed.statusCode, 400);
  assert.equal(json(malformed).message, 'Invalid ICCID');
});

test('updating the customer reference requires both parameters', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const ok = await api(app, { method: 'PUT', url: `/esims?iccid=${iccid}&customerRef=ABC-1` });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(json(ok), { status: 'success' });
  assert.equal(json(await api(app, { method: 'GET', url: `/esims/${iccid}` })).customerRef, 'ABC-1');

  const viaBody = await api(app, {
    method: 'PUT',
    url: '/esims',
    payload: { iccid, customerRef: 'ABC-2' },
  });
  assert.equal(viaBody.statusCode, 200);

  assert.equal((await api(app, { method: 'PUT', url: `/esims?iccid=${iccid}` })).statusCode, 400);
  assert.equal((await api(app, { method: 'PUT', url: '/esims?customerRef=x' })).statusCode, 400);
});

test('deleting an eSIM deactivates it and closes it for new bundles', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const deleted = await api(app, { method: 'DELETE', url: `/esims/${iccid}` });
  assert.equal(deleted.statusCode, 200);
  assert.match(json(deleted).status, /deleted/i);

  const esim = json(await api(app, { method: 'GET', url: `/esims/${iccid}` }));
  assert.equal(esim.state, 'deactivated');
  assert.equal(esim.profileStatus, 'Deactivated');

  assert.equal((await api(app, { method: 'DELETE', url: `/esims/${iccid}` })).statusCode, 400);

  await stock(app, 'esim_1GB_7D_GB_V2', 1);
  const apply = await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { iccid, name: 'esim_1GB_7D_GB_V2', allowReassign: true },
  });
  assert.equal(apply.statusCode, 400);
  assert.match(json(apply).message, /deactivated/);
});

test('refresh and compatibility behave per profile', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const refreshed = await api(app, { method: 'GET', url: `/esims/${iccid}/refresh` });
  assert.deepEqual(json(refreshed), { status: 'Successfully refreshed SIM' });

  const same = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/compatible/esim_1GB_7D_GB_V2` }),
  );
  assert.deepEqual(same, { compatible: true });

  const catalogue = json(await api(app, { method: 'GET', url: '/catalogue?perPage=500' }));
  const other = catalogue.find((bundle) => bundle.profileName !== 'Profile 1');
  const mismatch = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/compatible/${other.name}` }),
  );
  assert.deepEqual(mismatch, { compatible: false });

  const unknown = json(
    await api(app, { method: 'GET', url: `/esims/${iccid}/compatible/esim_nope` }),
  );
  assert.deepEqual(unknown, { compatible: false });
});

test('SMS enforces the documented limits and eSIM state', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const sent = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/sms`,
    payload: { message: 'Welcome! Your eSIM is now active.', from: 'eSIM' },
  });
  assert.equal(sent.statusCode, 200);
  assert.deepEqual(json(sent), { status: 'sent' });

  const { sms } = json(await mock(app, { method: 'GET', url: '/sms' }));
  assert.equal(sms[0].message, 'Welcome! Your eSIM is now active.');
  assert.equal(sms[0].from, 'eSIM');

  const empty = await api(app, { method: 'POST', url: `/esims/${iccid}/sms`, payload: { message: '' } });
  assert.equal(empty.statusCode, 400);

  const tooLong = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/sms`,
    payload: { message: 'x'.repeat(161) },
  });
  assert.equal(tooLong.statusCode, 400);

  await api(app, { method: 'DELETE', url: `/esims/${iccid}` });
  const toDeleted = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/sms`,
    payload: { message: 'hello' },
  });
  assert.equal(toDeleted.statusCode, 400);
});

test('suspend and unsuspend follow the documented constraints', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const suspended = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/suspend`,
    payload: { suspend: true },
  });
  assert.equal(suspended.statusCode, 201);
  assert.deepEqual(json(suspended), { status: 'eSIM suspended successfully' });
  assert.deepEqual(json(await api(app, { method: 'GET', url: `/esims/${iccid}/suspend` })), {
    suspended: true,
  });

  const again = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/suspend`,
    payload: { suspend: true },
  });
  assert.equal(again.statusCode, 400);

  const unsuspended = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/suspend`,
    payload: { suspend: false },
  });
  assert.equal(unsuspended.statusCode, 201);
  assert.equal(json(await api(app, { method: 'GET', url: `/esims/${iccid}` })).state, 'active');

  const missingField = await api(app, { method: 'POST', url: `/esims/${iccid}/suspend`, payload: {} });
  assert.equal(missingField.statusCode, 400);
});

test('a policy suspension cannot be lifted through the API', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  await mock(app, { method: 'POST', url: `/esims/${iccid}/policy-suspend` });
  const response = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/suspend`,
    payload: { suspend: false },
  });

  assert.equal(response.statusCode, 403);
  assert.match(json(response).message, /policy/);
});

test('location is empty until the eSIM attaches, then tracks the network', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  const before = json(await api(app, { method: 'GET', url: `/esims/${iccid}/location` }));
  assert.equal(before.country, '');

  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: { iso: 'FR' } });
  const after = json(await api(app, { method: 'GET', url: `/esims/${iccid}/location` }));
  assert.equal(after.country, 'FR');
  assert.equal(after.networkName, 'Orange');
  assert.equal(after.networkBrandName, 'Orange France');
  assert.ok(after.lastSeen);
});

test('history records the lifecycle newest first', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  await api(app, { method: 'PUT', url: `/esims?iccid=${iccid}&customerRef=H1` });
  await api(app, { method: 'GET', url: `/esims/${iccid}/refresh` });

  const history = json(await api(app, { method: 'GET', url: `/esims/${iccid}/history` }));
  assert.deepEqual(
    history.slice(0, 3).map((entry) => entry.name),
    ['eSIM Refreshed', 'eSIM Updated', 'Bundle Applied'],
  );
  assert.equal(history.at(-1).name, 'Bundle Applied', 'provisioning itself is not a history event');
  assert.equal(history[2].bundleName, 'esim_1GB_7D_GB_V2');
});

test('install details are served as JSON, CSV or a ZIP of QR codes', async () => {
  const app = await createApp();
  const { reference } = await orderEsim(app, 'esim_1GB_7D_GB_V2', 2);

  const asJson = json(
    await api(app, {
      method: 'GET',
      url: `/esims/assignments?reference=${reference}&additionalFields=installUrl`,
      headers: { accept: 'application/json' },
    }),
  );
  assert.equal(asJson.length, 2);
  assert.equal(asJson[0].profileStatus, 'Released');
  assert.ok(asJson[0].appleInstallUrl);

  const asCsv = await api(app, { method: 'GET', url: `/esims/assignments?reference=${reference}` });
  assert.match(asCsv.headers['content-type'], /text\/csv/);
  const lines = asCsv.body.trim().split('\n');
  assert.equal(lines[0], '"ICCID","Matching ID","RSP URL","Bundle"');
  assert.equal(lines.length, 3);

  const asZip = await api(app, {
    method: 'GET',
    url: `/esims/assignments?reference=${reference}`,
    headers: { accept: 'application/zip' },
  });
  assert.equal(asZip.headers['content-type'], 'application/zip');
  const zip = asZip.rawPayload;
  assert.equal(zip.subarray(0, 2).toString('latin1'), 'PK', 'a real ZIP local file header');
  assert.ok(zip.includes(Buffer.from(`${reference}.csv`)), 'the archive carries the mapping CSV');
  assert.ok(zip.includes(Buffer.from('.png')), 'and one QR image per eSIM');
});

test('install details for a deactivated eSIM are 410 Gone', async () => {
  const app = await createApp();
  const { iccid, reference } = await orderEsim(app);

  await api(app, { method: 'DELETE', url: `/esims/${iccid}` });
  const response = await api(app, {
    method: 'GET',
    url: `/esims/assignments?reference=${reference}`,
    headers: { accept: 'application/json' },
  });

  assert.equal(response.statusCode, 410);
});

test('an unknown reference is a 400', async () => {
  const app = await createApp();
  const response = await api(app, { method: 'GET', url: '/esims/assignments?reference=nope' });

  assert.equal(response.statusCode, 400);
  assert.match(json(response).message, /No eSIMs found/);
});
