import { cataloguePage, bundleDetail, cataloguePrices } from '../domain/catalogue.js';

/**
 * Routes under /catalogue: bundle browsing and consumption prices.
 */

/**
 * Register the catalogue routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function catalogueRoutes(app) {
  /**
   * GET /catalogue - filter, order and paginate the bundle catalogue.
   */
  app.get('/catalogue', async (request) => cataloguePage(request.query ?? {}));

  /**
   * GET /catalogue/prices - per-country consumption price list.
   *
   * Registered before the `/catalogue/bundle/:name` route because it is a
   * static path on the same prefix.
   */
  app.get('/catalogue/prices', async () => cataloguePrices());

  /**
   * GET /catalogue/bundle/{name} - one bundle with its coverage and allowances.
   */
  app.get('/catalogue/bundle/:name', async (request) => bundleDetail(request.params.name));
}
