import { networksPayload } from '../domain/networks.js';

/**
 * Route for /networks: country and operator reference data.
 */

/**
 * Register the networks route.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function networkRoutes(app) {
  /**
   * GET /networks - networks per country.
   *
   * Filter with `countries` (names), `isos` (ISO2 codes) or `returnAll=true`.
   */
  app.get('/networks', async (request) => networksPayload(request.query ?? {}));
}
