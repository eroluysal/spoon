import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { ApiError } from './util/errors.js';
import { authHook } from './plugins/auth.js';
import { rateLimitHook } from './plugins/ratelimit.js';
import { failureHook } from './plugins/failures.js';
import esimRoutes from './routes/esims.js';
import bundleRoutes from './routes/bundles.js';
import orderRoutes from './routes/orders.js';
import organisationRoutes from './routes/organisation.js';
import inventoryRoutes from './routes/inventory.js';
import catalogueRoutes from './routes/catalogue.js';
import networkRoutes from './routes/networks.js';
import deprecatedRoutes from './routes/deprecated.js';
import mockRoutes from './routes/mock.js';

/**
 * HTTP layer: one Fastify instance serving the eSIM Go v2.5 surface under
 * `config.basePath` and the mock control plane under /__mock.
 */

/**
 * Every operation the mock implements, used by the index route.
 *
 * @type {{method: string, path: string, summary: string, deprecated?: boolean}[]}
 */
export const OPERATIONS = [
  { method: 'GET', path: '/esims', summary: 'List eSIMs' },
  { method: 'PUT', path: '/esims', summary: 'Update eSIM details' },
  { method: 'POST', path: '/esims/apply', summary: 'Apply bundle to an eSIM' },
  { method: 'GET', path: '/esims/assignments', summary: 'Get eSIM install details (JSON / CSV / ZIP)' },
  { method: 'GET', path: '/esims/{iccid}', summary: 'Get eSIM details' },
  { method: 'DELETE', path: '/esims/{iccid}', summary: 'Delete (deactivate) eSIM' },
  { method: 'GET', path: '/esims/{iccid}/history', summary: 'Get eSIM history' },
  { method: 'GET', path: '/esims/{iccid}/refresh', summary: 'Refresh eSIM' },
  { method: 'GET', path: '/esims/{iccid}/compatible/{bundle}', summary: 'Check eSIM and bundle compatibility' },
  { method: 'POST', path: '/esims/{iccid}/sms', summary: 'Send SMS to eSIM' },
  { method: 'GET', path: '/esims/{iccid}/bundles', summary: 'List bundles applied to eSIM' },
  { method: 'GET', path: '/esims/{iccid}/bundles/{name}', summary: 'Get applied bundle status' },
  { method: 'DELETE', path: '/esims/{iccid}/bundles/{name}', summary: 'Revoke applied bundle' },
  {
    method: 'DELETE',
    path: '/esims/{iccid}/bundles/{name}/assignments/{assignmentId}',
    summary: 'Revoke specific bundle assignment',
  },
  { method: 'POST', path: '/esims/{iccid}/suspend', summary: 'Suspend or unsuspend an eSIM' },
  { method: 'GET', path: '/esims/{iccid}/suspend', summary: 'Get suspension state' },
  { method: 'GET', path: '/esims/{iccid}/location', summary: 'Get eSIM location' },
  { method: 'GET', path: '/organisation', summary: 'Get current organisation details' },
  { method: 'POST', path: '/organisation/balance', summary: 'Topup organisation balance' },
  { method: 'GET', path: '/organisation/groups', summary: 'Get bundle groups' },
  { method: 'GET', path: '/orders', summary: 'List orders' },
  { method: 'POST', path: '/orders', summary: 'Create orders (validate / transaction)' },
  { method: 'GET', path: '/orders/{orderReference}', summary: 'Get order detail' },
  { method: 'GET', path: '/inventory', summary: 'Get bundle inventory' },
  { method: 'POST', path: '/inventory/refund', summary: 'Refund bundle from inventory' },
  { method: 'GET', path: '/catalogue', summary: 'Get bundle catalogue' },
  { method: 'GET', path: '/catalogue/bundle/{name}', summary: 'Get bundle details from catalogue' },
  { method: 'GET', path: '/catalogue/prices', summary: 'Consumption - get prices' },
  { method: 'GET', path: '/networks', summary: 'Get country network data' },
  { method: 'GET', path: '/esims/qr/{reference}', summary: 'Get QR codes ZIP', deprecated: true },
  { method: 'GET', path: '/esims/csv/{reference}', summary: 'Get eSIM CSV', deprecated: true },
  { method: 'POST', path: '/esims/{iccid}/bundles', summary: 'Apply a bundle to an eSIM', deprecated: true },
  {
    method: 'DELETE',
    path: '/esims/{iccid}/bundles/{name}/applications/{assignmentId}',
    summary: 'Revoke a specific bundle assignment',
    deprecated: true,
  },
];

/**
 * Build the Fastify application.
 *
 * @param {object} [options]
 * @param {boolean|object} [options.logger] Fastify logger option (default: level from config).
 * @returns {Promise<import('fastify').FastifyInstance>} A ready-to-listen server.
 */
export async function buildServer(options = {}) {
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    trustProxy: true,
  });

  app.decorate('esimgoBasePath', config.basePath);

  await app.register(cors, { origin: true, exposedHeaders: ['X-Ratelimit-Limit', 'X-Ratelimit-Remaining', 'X-Ratelimit-Reset', 'X-Ratelimit-Cost', 'Retry-After', 'Deprecation'] });

  // The live API tolerates an empty body on POSTs that take everything in the
  // query string (for example /organisation/balance), and answers malformed
  // JSON with the standard {"message": ...} envelope.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === undefined || body === null || String(body).trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(String(body)));
    } catch {
      done(new ApiError(400, 'Invalid JSON in request body'), undefined);
    }
  });

  /**
   * Single error envelope: `{"message": "..."}` with the original status.
   */
  app.setErrorHandler((error, request, reply) => {
    const status = error instanceof ApiError ? error.statusCode : error.statusCode ?? 500;
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    const message = status >= 500 && !(error instanceof ApiError) ? 'Server Error' : error.message;
    reply.code(status).send({ message });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ message: `No route for ${request.method} ${request.url}` });
  });

  /**
   * GET / - unauthenticated index describing the mock.
   */
  app.get('/', async () => ({
    name: 'Spoon',
    description: 'Mock of the eSIM Go Travel API v2.5',
    upstream: 'https://api.esim-go.com/v2.5',
    baseUrl: config.basePath,
    auth: { header: 'X-API-Key', keys: config.apiKeys },
    controlPlane: '/__mock',
    operations: OPERATIONS,
  }));

  // The versioned API surface: authenticated, rate limited, failure injectable.
  await app.register(
    async (api) => {
      api.addHook('onRequest', rateLimitHook);
      api.addHook('onRequest', authHook);
      api.addHook('onRequest', failureHook);

      await api.register(esimRoutes);
      await api.register(bundleRoutes);
      await api.register(orderRoutes);
      await api.register(organisationRoutes);
      await api.register(inventoryRoutes);
      await api.register(catalogueRoutes);
      await api.register(networkRoutes);
      await api.register(deprecatedRoutes);
    },
    { prefix: config.basePath },
  );

  // The control plane is deliberately unauthenticated: it only exists in the mock.
  await app.register(mockRoutes, { prefix: '/__mock' });

  return app;
}
