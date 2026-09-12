import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, api, json, BASE, API_KEY } from './helpers.js';

test('the index route describes the mock without authentication', async () => {
  const app = await createApp();
  const response = await app.inject({ method: 'GET', url: '/' });
  const body = json(response);

  assert.equal(response.statusCode, 200);
  assert.equal(body.baseUrl, BASE);
  assert.ok(body.operations.length >= 33, 'every v2.5 operation is listed');
});

test('a missing API key is 403 with the standard error envelope', async () => {
  const app = await createApp();
  const response = await app.inject({ method: 'GET', url: `${BASE}/esims` });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(json(response), { message: 'Forbidden' });
});

test('an unknown API key is 403', async () => {
  const app = await createApp();
  const response = await app.inject({
    method: 'GET',
    url: `${BASE}/esims`,
    headers: { 'x-api-key': 'nope' },
  });

  assert.equal(response.statusCode, 403);
});

test('the header name is case insensitive and every configured key works', async () => {
  const app = await createApp();

  const upper = await app.inject({
    method: 'GET',
    url: `${BASE}/organisation`,
    headers: { 'X-API-KEY': API_KEY },
  });
  const second = await app.inject({
    method: 'GET',
    url: `${BASE}/organisation`,
    headers: { 'x-api-key': 'second-key' },
  });

  assert.equal(upper.statusCode, 200);
  assert.equal(second.statusCode, 200);
});

test('unknown routes answer 404 with a message', async () => {
  const app = await createApp();
  const response = await api(app, { method: 'GET', url: '/nope' });

  assert.equal(response.statusCode, 404);
  assert.match(json(response).message, /No route/);
});

test('malformed JSON is a 400, not a crash', async () => {
  const app = await createApp();
  const response = await app.inject({
    method: 'POST',
    url: `${BASE}/orders`,
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
    payload: '{"type":',
  });

  assert.equal(response.statusCode, 400);
  assert.match(json(response).message, /Invalid JSON/);
});

test('the rate limiter answers 429 with Retry-After once the window is spent', async () => {
  const { config } = await import('../src/config.js');
  const { resetRateLimits } = await import('../src/plugins/ratelimit.js');
  const app = await createApp();

  config.rateLimit.enabled = true;
  resetRateLimits();
  try {
    /** @type {import('light-my-request').Response[]} */
    const responses = [];
    for (let i = 0; i < 12; i += 1) {
      responses.push(await api(app, { method: 'GET', url: '/organisation' }));
    }

    const ok = responses.filter((r) => r.statusCode === 200);
    const limited = responses.filter((r) => r.statusCode === 429);

    assert.equal(ok.length, 10, '10 requests per second get through');
    assert.ok(limited.length > 0, 'the rest are rate limited');
    assert.equal(ok[0].headers['x-ratelimit-limit'], '10');
    assert.equal(ok[0].headers['x-ratelimit-remaining'], '9');
    assert.ok(ok[0].headers['x-ratelimit-reset']);
    assert.equal(limited[0].headers['retry-after'], '1');
    assert.deepEqual(json(limited[0]), { message: 'Rate limit exceeded' });
  } finally {
    config.rateLimit.enabled = false;
    resetRateLimits();
  }
});

test('heavier endpoints cost more than one token', async () => {
  const { config } = await import('../src/config.js');
  const { resetRateLimits } = await import('../src/plugins/ratelimit.js');
  const app = await createApp();

  config.rateLimit.enabled = true;
  resetRateLimits();
  try {
    const response = await api(app, { method: 'GET', url: '/catalogue?perPage=10' });
    assert.equal(response.headers['x-ratelimit-cost'], '5');
    assert.equal(response.headers['x-ratelimit-remaining'], '5');
  } finally {
    config.rateLimit.enabled = false;
    resetRateLimits();
  }
});
