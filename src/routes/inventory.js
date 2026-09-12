import { requireObject, requireInt } from '../util/validate.js';
import { inventoryPayload, refundStock } from '../domain/inventory.js';

/**
 * Routes under /inventory: stock levels and refunds.
 */

/**
 * Register the inventory routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function inventoryRoutes(app) {
  /**
   * GET /inventory - bundles held in inventory with their available batches.
   */
  app.get('/inventory', async () => inventoryPayload());

  /**
   * POST /inventory/refund - refund unused inventory back to the balance.
   *
   * `usageId` is the batch id reported by GET /inventory.
   */
  app.post('/inventory/refund', async (request) => {
    const body = requireObject(request.body);
    const usageId = requireInt(body.usageId, 'usageId', { min: 1 });
    const quantity = requireInt(body.quantity, 'quantity', { min: 1 });
    const result = refundStock(usageId, quantity);
    return {
      status: `Successfully refunded ${result.refunded} bundle${result.refunded === 1 ? '' : 's'} to balance`,
    };
  });
}
