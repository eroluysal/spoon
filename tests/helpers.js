/**
 * Shared test harness.
 *
 * Configuration is read from the environment when `src/config.js` is first
 * imported, so this module sets the test profile before importing anything
 * else, then hands out a fresh Fastify instance driven through `app.inject()` -
 * no ports, no sleeping.
 */

process.env.LOG_LEVEL = 'silent';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.SEED_ESIMS = '0';
process.env.SEED_INVENTORY = 'false';
process.env.SIM_AUTO_INSTALL_AFTER_MS = '0';
process.env.SIM_PROCESSING_MS = '0';
process.env.SIM_AUTO_USAGE = 'false';
process.env.API_KEYS = 'test-key,second-key';
process.env.BASE_PATH = '/v2.5';

const { buildServer } = await import('../src/server.js');
const { resetState } = await import('../src/store/state.js');
const { resetEngine } = await import('../src/sim/engine.js');
const { resetRateLimits } = await import('../src/plugins/ratelimit.js');

/** API key every test request carries. */
export const API_KEY = 'test-key';

/** Versioned API prefix under test. */
export const BASE = '/v2.5';

/**
 * Build a server on a clean state.
 *
 * @returns {Promise<import('fastify').FastifyInstance>} A fresh app instance.
 */
export async function createApp() {
  resetState();
  resetEngine();
  resetRateLimits();
  return buildServer({ logger: false });
}

/**
 * Inject an authenticated request into the versioned API.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {object} options
 * @param {string} options.method HTTP method.
 * @param {string} options.url Path relative to the API prefix, e.g. `/esims`.
 * @param {object} [options.payload] JSON body.
 * @param {object} [options.headers] Extra headers.
 * @returns {Promise<import('light-my-request').Response>}
 */
export function api(app, { method, url, payload, headers = {} }) {
  return app.inject({
    method,
    url: `${BASE}${url}`,
    payload,
    headers: { 'x-api-key': API_KEY, ...headers },
  });
}

/**
 * Inject a request into the /__mock control plane.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {object} options
 * @param {string} options.method
 * @param {string} options.url Path relative to /__mock.
 * @param {object} [options.payload]
 * @returns {Promise<import('light-my-request').Response>}
 */
export function mock(app, { method, url, payload }) {
  return app.inject({ method, url: `/__mock${url}`, payload });
}

/**
 * Parse a response body as JSON.
 *
 * @param {import('light-my-request').Response} response
 * @returns {any}
 */
export const json = (response) => JSON.parse(response.body);

/**
 * Put bundles into inventory through the control plane.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {string} name Bundle name.
 * @param {number} [quantity]
 * @returns {Promise<object>} The inventory row.
 */
export async function stock(app, name, quantity = 1) {
  const response = await mock(app, { method: 'POST', url: '/inventory', payload: { name, quantity } });
  return json(response);
}

/**
 * Place a transaction order and return the first provisioned ICCID.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {string} [item] Bundle to order.
 * @param {number} [quantity]
 * @returns {Promise<{order: object, iccid: string, reference: string}>}
 */
export async function orderEsim(app, item = 'esim_1GB_7D_GB_V2', quantity = 1) {
  const response = await api(app, {
    method: 'POST',
    url: '/orders',
    payload: { type: 'transaction', assign: true, order: [{ type: 'bundle', item, quantity }] },
  });
  const order = json(response);
  return {
    order,
    iccid: order.order[0].esims[0].iccid,
    reference: order.orderReference,
  };
}
