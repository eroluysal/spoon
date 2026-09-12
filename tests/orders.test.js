import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, mock, json, stock } from './helpers.js';

test('a validate order prices the basket without provisioning anything', async () => {
  const app = await createApp();
  const before = json(await api(app, { method: 'GET', url: '/organisation' })).balance;

  const body = json(
    await api(app, {
      method: 'POST',
      url: '/orders',
      payload: {
        type: 'validate',
        assign: true,
        order: [{ type: 'bundle', item: 'esim_1GB_7D_GB_V2', quantity: 2 }],
      },
    }),
  );

  assert.equal(body.valid, true);
  assert.equal(body.assigned, true);
  assert.equal(body.total, 4.56);
  assert.equal(body.order[0].pricePerUnit, 2.28);
  assert.equal(body.order[0].subTotal, 4.56);

  const after = json(await api(app, { method: 'GET', url: '/organisation' })).balance;
  assert.equal(after, before, 'validate never charges the balance');
  assert.equal(json(await api(app, { method: 'GET', url: '/esims' })).esims.length, 0);
});

test('a transaction order with assign provisions eSIMs and charges the balance', async () => {
  const app = await createApp();
  const before = json(await api(app, { method: 'GET', url: '/organisation' })).balance;

  const order = json(
    await api(app, {
      method: 'POST',
      url: '/orders',
      payload: {
        type: 'transaction',
        assign: true,
        order: [{ type: 'bundle', item: 'esim_1GB_7D_GB_V2', quantity: 2 }],
      },
    }),
  );

  assert.equal(order.status, 'completed');
  assert.match(order.statusMessage, /2 eSIMs assigned/);
  assert.equal(order.order[0].iccids.length, 2);
  assert.equal(order.order[0].esims.length, 2);
  assert.ok(order.order[0].esims[0].matchingId);
  assert.ok(order.orderReference);
  assert.equal(Number(order.runningBalance), before - 4.56);

  const after = json(await api(app, { method: 'GET', url: '/organisation' })).balance;
  assert.equal(after, before - 4.56);
});

test('a transaction order without assign only fills inventory', async () => {
  const app = await createApp();

  const order = json(
    await api(app, {
      method: 'POST',
      url: '/orders',
      payload: {
        type: 'transaction',
        assign: false,
        order: [{ type: 'bundle', item: 'esim_5GB_30D_GB_V2', quantity: 4 }],
      },
    }),
  );

  assert.match(order.statusMessage, /4 bundles added to inventory/);
  assert.equal(json(await api(app, { method: 'GET', url: '/esims' })).esims.length, 0);

  const { bundles } = json(await api(app, { method: 'GET', url: '/inventory' }));
  const row = bundles.find((bundle) => bundle.name === 'esim_5GB_30D_GB_V2');
  assert.equal(row.available[0].remaining, 4);
});

test('bundles can be ordered straight onto existing eSIMs', async () => {
  const app = await createApp();
  const { iccids } = json(await mock(app, { method: 'POST', url: '/esims', payload: { count: 1 } }));
  const [iccid] = iccids;

  const order = json(
    await api(app, {
      method: 'POST',
      url: '/orders',
      payload: {
        type: 'transaction',
        assign: true,
        order: [
          { type: 'bundle', item: 'esim_1GB_7D_GB_V2', quantity: 1, iccids: [iccid], allowReassign: true },
        ],
      },
    }),
  );

  assert.deepEqual(order.order[0].iccids, [iccid]);

  const { bundles } = json(await api(app, { method: 'GET', url: `/esims/${iccid}/bundles` }));
  assert.equal(bundles[0].name, 'esim_1GB_7D_GB_V2');
});

test('order validation follows the documented rules', async () => {
  const app = await createApp();

  const iccidsWithoutAssign = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: {
      type: 'transaction',
      assign: false,
      order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 1, iccids: ['8943108100000000010'] }],
    },
  });
  assert.equal(iccidsWithoutAssign.statusCode, 400);
  assert.match(json(iccidsWithoutAssign).message, /only be specified when assign/);

  const profileWithoutAssign = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: {
      type: 'transaction',
      assign: false,
      profileID: 'brand-1',
      order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 1 }],
    },
  });
  assert.equal(profileWithoutAssign.statusCode, 400);

  const { iccids } = json(await mock(app, { method: 'POST', url: '/esims', payload: { count: 1 } }));
  const quantityMismatch = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: {
      type: 'transaction',
      assign: true,
      order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 2, iccids, allowReassign: true }],
    },
  });
  assert.equal(quantityMismatch.statusCode, 400);
  assert.match(json(quantityMismatch).message, /must match the number of ICCIDs/);

  const unknownBundle = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: { type: 'transaction', order: [{ item: 'esim_nope', quantity: 1 }] },
  });
  assert.equal(unknownBundle.statusCode, 400);

  const noLines = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: { type: 'transaction', order: [] },
  });
  assert.equal(noLines.statusCode, 400);
});

test('an incompatible eSIM needs allowReassign', async () => {
  const app = await createApp();
  const { iccids } = json(
    await mock(app, { method: 'POST', url: '/esims', payload: { count: 1, profileName: 'Profile 1' } }),
  );
  const incompatible = json(
    await api(app, { method: 'GET', url: '/catalogue?perPage=500' }),
  ).find((bundle) => bundle.profileName !== 'Profile 1');

  const rejected = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: {
      type: 'transaction',
      assign: true,
      order: [{ item: incompatible.name, quantity: 1, iccids }],
    },
  });
  assert.equal(rejected.statusCode, 400);
  assert.match(json(rejected).message, /not compatible/);

  const accepted = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: {
      type: 'transaction',
      assign: true,
      order: [{ item: incompatible.name, quantity: 1, iccids, allowReassign: true }],
    },
  });
  assert.equal(accepted.statusCode, 200);
});

test('an order larger than the balance is refused', async () => {
  const app = await createApp();
  await mock(app, { method: 'PATCH', url: '/organisation', payload: { balance: 3 } });

  const response = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: {
      type: 'transaction',
      assign: false,
      order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 10 }],
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(json(response).message, /Insufficient balance/);
});

test('orders can be listed, filtered by date and fetched by reference', async () => {
  const app = await createApp();
  await stock(app, 'esim_1GB_7D_GB_V2', 1);

  const first = json(
    await api(app, {
      method: 'POST',
      url: '/orders',
      payload: { type: 'transaction', assign: true, order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 1 }] },
    }),
  );
  await mock(app, { method: 'POST', url: '/clock', payload: { days: 2 } });
  const second = json(
    await api(app, {
      method: 'POST',
      url: '/orders',
      payload: { type: 'transaction', assign: false, order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 1 }] },
    }),
  );

  const all = json(await api(app, { method: 'GET', url: '/orders?limit=10' }));
  assert.equal(all.length, 2);
  assert.equal(all[0].orderReference, second.orderReference, 'newest first');
  assert.equal(all[0].order[0].esims, undefined, 'eSIM data is opt-in');

  const withIccids = json(await api(app, { method: 'GET', url: '/orders?includeIccids=true' }));
  assert.ok(Array.isArray(withIccids[0].order[0].iccids));

  const older = json(
    await api(app, { method: 'GET', url: `/orders?createdAt=lte:${first.createdDate}` }),
  );
  assert.equal(older.length, 1);
  assert.equal(older[0].orderReference, first.orderReference);

  const detail = json(await api(app, { method: 'GET', url: `/orders/${first.orderReference}` }));
  assert.equal(detail.orderReference, first.orderReference);

  const missing = await api(app, { method: 'GET', url: '/orders/does-not-exist' });
  assert.equal(missing.statusCode, 400);
});

test('a branding profile id is echoed back on the order', async () => {
  const app = await createApp();
  const order = json(
    await api(app, {
      method: 'POST',
      url: '/orders',
      payload: {
        type: 'transaction',
        assign: true,
        profileID: 'f616f7g8-ey0d-123d-803d-0214a2f5dafb',
        order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 1 }],
      },
    }),
  );

  assert.equal(order.brandingId, 'f616f7g8-ey0d-123d-803d-0214a2f5dafb');
  const iccid = order.order[0].iccids[0];
  const esim = json(await api(app, { method: 'GET', url: `/esims/${iccid}` }));
  assert.equal(esim.brandingId, 'f616f7g8-ey0d-123d-803d-0214a2f5dafb');
});
