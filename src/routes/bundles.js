import { optionalBoolean, optionalInt, optionalEnum } from '../util/validate.js';
import { requireEsim } from '../domain/esims.js';
import {
  bundlesForEsimPayload,
  bundleStatusPayload,
  findRevocable,
  validateRevoke,
  revokeAssignment,
  requireBundle,
} from '../domain/bundles.js';

/**
 * Routes under /esims/{iccid}/bundles: listing applied bundles, their status
 * and revoking them.
 */

/**
 * Register the bundle assignment routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function bundleRoutes(app) {
  /**
   * GET /esims/{iccid}/bundles - bundles applied to an eSIM.
   *
   * Defaults to the 15 most recent live assignments; `includeUsed=true` adds
   * expired, depleted, revoked and lapsed ones, and `limit` goes up to 200.
   */
  app.get('/esims/:iccid/bundles', async (request) => {
    const query = request.query ?? {};
    requireEsim(request.params.iccid);
    const includeUsed = optionalBoolean(query.includeUsed, 'includeUsed', false);
    const limit = optionalInt(query.limit, 'limit', { min: 1, max: 200 }) ?? 15;
    return bundlesForEsimPayload(request.params.iccid, { includeUsed, limit });
  });

  /**
   * GET /esims/{iccid}/bundles/{name} - every assignment of one bundle.
   */
  app.get('/esims/:iccid/bundles/:name', async (request) => {
    requireEsim(request.params.iccid);
    requireBundle(request.params.name);
    return bundleStatusPayload(request.params.iccid, request.params.name);
  });

  /**
   * DELETE /esims/{iccid}/bundles/{name} - revoke the latest assignment of a bundle.
   *
   * `offerId` targets a specific assignment, `refundToBalance` credits the
   * organisation balance instead of returning the bundle to inventory, and
   * `type=validate` reports what would happen without doing it.
   */
  app.delete('/esims/:iccid/bundles/:name', async (request) => {
    const query = request.query ?? {};
    requireEsim(request.params.iccid);

    const type = optionalEnum(query.type, 'type', ['validate', 'transaction'], 'transaction');
    const refundToBalance = optionalBoolean(query.refundToBalance, 'refundToBalance', false);
    const assignment = findRevocable(request.params.iccid, request.params.name, query.offerId);

    return type === 'validate'
      ? validateRevoke(assignment, refundToBalance)
      : revokeAssignment(assignment, { refundToBalance });
  });

  /**
   * DELETE /esims/{iccid}/bundles/{name}/assignments/{assignmentId} - revoke one
   * specific assignment.
   */
  app.delete('/esims/:iccid/bundles/:name/assignments/:assignmentId', async (request) => {
    const query = request.query ?? {};
    requireEsim(request.params.iccid);

    const type = optionalEnum(query.type, 'type', ['validate', 'transaction'], 'transaction');
    const refundToBalance = optionalBoolean(query.refundToBalance, 'refundToBalance', false);
    const assignment = findRevocable(
      request.params.iccid,
      request.params.name,
      request.params.assignmentId,
    );

    return type === 'validate'
      ? validateRevoke(assignment, refundToBalance)
      : revokeAssignment(assignment, { refundToBalance });
  });
}
