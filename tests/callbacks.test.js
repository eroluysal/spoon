import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createApp, api, mock, json, stock, orderEsim, API_KEY } from './helpers.js';

/**
 * Start a throwaway HTTP receiver that records every callback it is sent.
 *
 * @returns {Promise<{url: string, received: {signature: string|undefined, raw: string, body: object}[], close: () => Promise<void>}>}
 */
async function receiver() {
  const received = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      received.push({
        signature: request.headers['x-signature-sha256'],
        raw,
        body: JSON.parse(raw || '{}'),
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/callback`,
    received,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Wait until the receiver has at least `count` callbacks, or time out.
 *
 * @param {{received: unknown[]}} hook
 * @param {number} count
 * @returns {Promise<void>}
 */
async function waitFor(hook, count) {
  for (let i = 0; i < 100 && hook.received.length < count; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('callbacks are logged even with no callback URL configured', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: { iso: 'GB' } });

  const { callbacks } = json(await mock(app, { method: 'GET', url: '/callbacks' }));
  const attachment = callbacks.find((entry) => entry.event === 'FirstAttachment');

  assert.ok(attachment, 'the attempt is recorded');
  assert.equal(attachment.delivered, false);
  assert.equal(attachment.error, 'no callbackUrl configured');
  assert.deepEqual(attachment.body, { alertType: 'FirstAttachment', iccid });
});

test('V3 callbacks are delivered with a valid HMAC-SHA256 signature', async () => {
  const app = await createApp();
  const hook = await receiver();
  try {
    await mock(app, {
      method: 'POST',
      url: '/callbacks/config',
      payload: { url: hook.url, version: 'V3' },
    });

    const { iccid } = await orderEsim(app);
    await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: { iso: 'GB' } });
    await waitFor(hook, 1);

    const [first] = hook.received;
    const expected = createHmac('sha256', API_KEY).update(first.raw).digest('base64');
    assert.equal(first.signature, expected, 'signed with the API key over the raw body');
    assert.equal(first.body.alertType, 'FirstAttachment');
  } finally {
    await hook.close();
  }
});

test('V2 callbacks are unsigned and carry the slim bundle object', async () => {
  const app = await createApp();
  const hook = await receiver();
  try {
    await mock(app, {
      method: 'POST',
      url: '/callbacks/config',
      payload: { url: hook.url, version: 'V2' },
    });

    const { iccid } = await orderEsim(app);
    await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
    await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
    await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 100 } });
    await waitFor(hook, 2);

    const usage = hook.received.find((entry) => entry.body.alertType === 'Utilisation');
    assert.ok(usage);
    assert.equal(usage.signature, undefined, 'V2 has no signature');
    assert.equal(usage.body.bundle.id, undefined, 'and no extended fields');
    assert.equal(usage.body.bundle.name, 'esim_1GB_7D_GB_V2');
    assert.equal(usage.body.bundle.initialQuantity, 1_000_000_000);
  } finally {
    await hook.close();
  }
});

test('utilisation fires once per 1/50/80/100 percent threshold', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  await mock(app, { method: 'DELETE', url: '/callbacks' });

  const percentages = async () =>
    json(await mock(app, { method: 'GET', url: '/callbacks?event=Utilisation' })).callbacks.length;

  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 15 } });
  assert.equal(await percentages(), 1, '1% crossed');

  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 485 } });
  assert.equal(await percentages(), 2, '50% crossed');

  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 300 } });
  assert.equal(await percentages(), 3, '80% crossed');

  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 200 } });
  assert.equal(await percentages(), 4, '100% crossed');

  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 10 } });
  assert.equal(await percentages(), 4, 'a depleted bundle stops reporting');
});

test('first use is reported once per assignment', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 10 } });
  await mock(app, { method: 'POST', url: `/esims/${iccid}/usage`, payload: { mb: 10 } });

  const { callbacks } = json(await mock(app, { method: 'GET', url: '/callbacks?event=FirstUse' }));
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].body.bundle.name, 'esim_1GB_7D_GB_V2');
});

test('moving country reports CountryChange, staying put does not', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);

  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: { iso: 'GB' } });
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: { iso: 'GB' } });
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: { iso: 'NO' } });

  const { callbacks } = json(await mock(app, { method: 'GET', url: '/callbacks?event=CountryChange' }));
  assert.equal(callbacks.length, 2, 'GB on first attach, then NO');
  assert.deepEqual(callbacks[0].body.country, { code: 'NO', name: 'Norway' });
});

test('a voice bundle enables then disables the MSISDN', async () => {
  const app = await createApp();
  await stock(app, 'esim_5GB_30D_GB_VS', 1);
  const applied = json(
    await api(app, {
      method: 'POST',
      url: '/esims/apply',
      payload: { bundles: [{ name: 'esim_5GB_30D_GB_VS' }] },
    }),
  );
  const iccid = applied.esims[0].iccid;

  // A Voice + SMS bundle does not autostart, so the eSIM has to attach first.
  await mock(app, { method: 'POST', url: `/esims/${iccid}/attach`, payload: {} });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });
  const enabled = json(await mock(app, { method: 'GET', url: '/callbacks?event=MSISDNEnabled' }));
  assert.equal(enabled.callbacks.length, 1);
  assert.equal(enabled.callbacks[0].body.reason, 'Bundle added');

  const esim = json(await api(app, { method: 'GET', url: `/esims/${iccid}` }));
  assert.ok(esim.msisdn, 'the MSISDN becomes visible while a voice bundle is live');

  await api(app, { method: 'DELETE', url: `/esims/${iccid}/bundles/esim_5GB_30D_GB_VS` });
  const disabled = json(await mock(app, { method: 'GET', url: '/callbacks?event=MSISDNDisabled' }));
  assert.equal(disabled.callbacks.length, 1);
  assert.equal(disabled.callbacks[0].body.reason, 'Bundle revoked');
});

test('a top-up reports Topup and a low balance reports LowBalance', async () => {
  const app = await createApp();

  await api(app, { method: 'POST', url: '/organisation/balance?amount=500' });
  const topups = json(await mock(app, { method: 'GET', url: '/callbacks?event=Topup' }));
  assert.equal(topups.callbacks.length, 1);
  assert.equal(topups.callbacks[0].body.bundle.oldAmount, 10000);
  assert.equal(topups.callbacks[0].body.bundle.newAmount, 10500);

  await mock(app, {
    method: 'PATCH',
    url: '/organisation',
    payload: { balance: 100, lowBalanceThreshold: 200 },
  });
  await api(app, {
    method: 'POST',
    url: '/orders',
    payload: { type: 'transaction', assign: false, order: [{ item: 'esim_1GB_7D_GB_V2', quantity: 1 }] },
  });

  const low = json(await mock(app, { method: 'GET', url: '/callbacks?event=LowBalance' }));
  assert.equal(low.callbacks.length, 1);
  assert.equal(low.callbacks[0].body.balanceInfo.threshold, 200);
  assert.ok(low.callbacks[0].body.balanceInfo.thresholdPercentRemaining > 0);
});

test('SMS to a suspended eSIM reports SMSFailed', async () => {
  const app = await createApp();
  const { iccid } = await orderEsim(app);
  await api(app, { method: 'POST', url: `/esims/${iccid}/suspend`, payload: { suspend: true } });

  const response = await api(app, {
    method: 'POST',
    url: `/esims/${iccid}/sms`,
    payload: { message: 'are you there?' },
  });
  assert.deepEqual(json(response), { status: 'failed' });

  const { callbacks } = json(await mock(app, { method: 'GET', url: '/callbacks?event=SMSFailed' }));
  assert.equal(callbacks.length, 1);
  assert.equal(callbacks[0].body.iccid, iccid);
  assert.ok(callbacks[0].body.timestamp);
});

test('the inactivity pipeline reports deletion_scheduled then deleted', async () => {
  const app = await createApp();
  const { iccids } = json(await mock(app, { method: 'POST', url: '/esims', payload: { count: 1 } }));
  const [iccid] = iccids;

  await mock(app, { method: 'POST', url: `/esims/${iccid}/idle`, payload: { days: 181 } });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  const scheduled = json(
    await mock(app, { method: 'GET', url: '/callbacks?event=esim.deletion_scheduled' }),
  );
  assert.equal(scheduled.callbacks.length, 1);
  assert.equal(scheduled.callbacks[0].body.event, 'esim.deletion_scheduled');
  assert.equal(scheduled.callbacks[0].body.iccid, iccid);

  await mock(app, { method: 'POST', url: '/clock', payload: { days: 8 } });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  const deleted = json(await mock(app, { method: 'GET', url: '/callbacks?event=esim.deleted' }));
  assert.equal(deleted.callbacks.length, 1);
  assert.equal(json(await api(app, { method: 'GET', url: `/esims/${iccid}` })).state, 'deactivated');
});

test('applying a bundle cancels a scheduled deletion', async () => {
  const app = await createApp();
  const { iccids } = json(await mock(app, { method: 'POST', url: '/esims', payload: { count: 1 } }));
  const [iccid] = iccids;

  await mock(app, { method: 'POST', url: `/esims/${iccid}/idle`, payload: { days: 181 } });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  await stock(app, 'esim_1GB_7D_GB_V2', 1);
  await api(app, {
    method: 'POST',
    url: '/esims/apply',
    payload: { iccid, name: 'esim_1GB_7D_GB_V2' },
  });

  await mock(app, { method: 'POST', url: '/clock', payload: { days: 8 } });
  await mock(app, { method: 'POST', url: '/tick', payload: { consume: false } });

  assert.equal(json(await api(app, { method: 'GET', url: `/esims/${iccid}` })).state, 'active');
  const deleted = json(await mock(app, { method: 'GET', url: '/callbacks?event=esim.deleted' }));
  assert.equal(deleted.callbacks.length, 0);
});

test('the control plane can fire every callback type on demand', async () => {
  const app = await createApp();
  await orderEsim(app);
  await mock(app, { method: 'DELETE', url: '/callbacks' });

  const { sent } = json(await mock(app, { method: 'POST', url: '/callbacks/test', payload: {} }));
  const events = sent.map((entry) => entry.event);

  for (const expected of [
    'Utilisation',
    'FirstUse',
    'FirstAttachment',
    'CountryChange',
    'Topup',
    'LowBalance',
    'esim.deletion_scheduled',
    'esim.deleted',
    'MSISDNEnabled',
    'MSISDNDisabled',
    'SMSFailed',
  ]) {
    assert.ok(events.includes(expected), `${expected} is supported`);
  }

  const unknown = await mock(app, {
    method: 'POST',
    url: '/callbacks/test',
    payload: { event: 'Nope' },
  });
  assert.equal(unknown.statusCode, 400);
});

test('a failing receiver is recorded, not retried into oblivion', async () => {
  const app = await createApp();
  await mock(app, {
    method: 'POST',
    url: '/callbacks/config',
    payload: { url: 'http://127.0.0.1:1/callback' },
  });

  await mock(app, { method: 'POST', url: '/callbacks/test', payload: { event: 'FirstAttachment' } });
  const { callbacks } = json(await mock(app, { method: 'GET', url: '/callbacks' }));

  assert.equal(callbacks[0].delivered, false);
  assert.ok(callbacks[0].error, 'the transport error is kept for inspection');
});
