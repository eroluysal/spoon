import { requireObject, requireString, optionalInt, optionalEnum } from '../util/validate.js';
import { requireEsim, requireInstallable } from '../domain/esims.js';
import { applyBundles, findRevocable, revokeAssignment, validateRevoke } from '../domain/bundles.js';
import { esimsForReference, referenceCsv, referenceZip, wantsInstallUrl } from './esims.js';

/**
 * Endpoints eSIM Go marks as deprecated in v2.5. They still work and are still
 * used by older integrations, so the mock keeps them, flagged with a
 * `Deprecation` response header.
 */

/**
 * Register the deprecated routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function deprecatedRoutes(app) {
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('Deprecation', 'true');
    return payload;
  });

  /**
   * GET /esims/qr/{reference} (deprecated) - ZIP of QR codes for a reference.
   *
   * Superseded by GET /esims/assignments with `Accept: application/zip`.
   */
  app.get('/esims/qr/:reference', async (request, reply) => {
    const reference = String(request.params.reference);
    const esims = esimsForReference(reference);
    for (const esim of esims) requireInstallable(esim);

    reply.header('Content-Type', 'application/zip');
    reply.header('Content-Disposition', `attachment; filename="${reference}.zip"`);
    return reply.send(await referenceZip(esims, reference));
  });

  /**
   * GET /esims/csv/{reference} (deprecated) - CSV of eSIMs for a reference.
   *
   * Superseded by GET /esims/assignments with the default Accept header.
   */
  app.get('/esims/csv/:reference', async (request, reply) => {
    const reference = String(request.params.reference);
    const esims = esimsForReference(reference);
    reply.header('Content-Type', 'text/csv');
    return reply.send(referenceCsv(esims, { installUrl: wantsInstallUrl(request.query ?? {}) }));
  });

  /**
   * POST /esims/{iccid}/bundles (deprecated) - apply a bundle to a known eSIM.
   *
   * Superseded by POST /esims/apply.
   */
  app.post('/esims/:iccid/bundles', async (request) => {
    const body = requireObject(request.body);
    const name = requireString(body.name, 'name');
    const repeat = optionalInt(body.repeat, 'repeat', { min: 1, max: 100 });
    const iccid = String(request.params.iccid);
    requireEsim(iccid);

    applyBundles({ iccid, bundles: [{ name, repeat, allowReassign: Boolean(body.allowReassign) }] });
    return { status: `Bundle ${name} applied to eSIM ${iccid}` };
  });

  /**
   * DELETE /esims/{iccid}/bundles/{name}/applications/{assignmentId} (deprecated)
   * - revoke one assignment.
   *
   * Superseded by the `/assignments/{assignmentId}` route.
   */
  app.delete('/esims/:iccid/bundles/:name/applications/:assignmentId', async (request) => {
    const query = request.query ?? {};
    requireEsim(request.params.iccid);
    const type = optionalEnum(query.type, 'type', ['validate', 'transaction'], 'transaction');
    const assignment = findRevocable(
      request.params.iccid,
      request.params.name,
      request.params.assignmentId,
    );
    return type === 'validate' ? validateRevoke(assignment, false) : revokeAssignment(assignment);
  });
}
