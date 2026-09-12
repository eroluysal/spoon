import { requireNumber } from '../util/validate.js';
import { organisationPayload, topup, bundleGroups } from '../domain/organisation.js';

/**
 * Routes under /organisation: details, balance top-up and bundle groups.
 */

/**
 * Register the organisation routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function organisationRoutes(app) {
  /**
   * GET /organisation - organisation details, balance and users.
   */
  app.get('/organisation', async () => organisationPayload());

  /**
   * POST /organisation/balance - charge the saved card and credit the balance.
   *
   * The amount is a query parameter in the live API; a JSON body is accepted too.
   */
  app.post('/organisation/balance', async (request) => {
    const query = request.query ?? {};
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const amount = requireNumber(query.amount ?? body.amount, 'amount', { min: 0.01 });
    return topup(amount);
  });

  /**
   * GET /organisation/groups - bundle groups available to the organisation.
   */
  app.get('/organisation/groups', async () => bundleGroups());
}
