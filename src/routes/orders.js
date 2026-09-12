import { parsePage, paginate } from '../util/paging.js';
import { optionalBoolean } from '../util/validate.js';
import {
  parseOrder,
  validateOrder,
  processOrder,
  orderPayload,
  requireOrder,
  listOrders,
} from '../domain/orders.js';

/**
 * Routes under /orders: validating, placing and reading orders.
 */

/**
 * Register the order routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function orderRoutes(app) {
  /**
   * GET /orders - orders newest first.
   *
   * `includeIccids=true` embeds the eSIM install details, and `createdAt`
   * accepts the comparator prefixes `lte:`, `gte:`, `lt:`, `gt:`.
   */
  app.get('/orders', async (request) => {
    const query = request.query ?? {};
    const { page, perPage } = parsePage(query.page, query.limit, { defaultPerPage: 10, maxPerPage: 200 });
    const includeIccids = optionalBoolean(query.includeIccids, 'includeIccids', false);
    const orders = listOrders({ createdAt: query.createdAt });
    return paginate(orders, { page, perPage }).map((order) => orderPayload(order, { includeIccids }));
  });

  /**
   * POST /orders - price (`type: validate`) or place (`type: transaction`) an order.
   */
  app.post('/orders', async (request) => {
    const parsed = parseOrder(request.body);
    if (parsed.type === 'validate') return validateOrder(parsed);
    const order = processOrder(parsed, { sourceIP: request.ip });
    return orderPayload(order, { includeIccids: true });
  });

  /**
   * GET /orders/{orderReference} - one order, with eSIM details included.
   */
  app.get('/orders/:orderReference', async (request) =>
    orderPayload(requireOrder(request.params.orderReference), { includeIccids: true }),
  );
}
