import { state, listEsims } from '../store/state.js';
import { badRequest } from '../util/errors.js';
import { parsePage, paginate, sortBy } from '../util/paging.js';
import { toCsv } from '../util/csv.js';
import { createZip } from '../util/zip.js';
import { qrPng } from '../util/qr.js';
import {
  requireObject,
  requireString,
  requireBoolean,
  optionalBoolean,
  optionalInt,
  optionalEnum,
} from '../util/validate.js';
import {
  requireEsim,
  updateCustomerRef,
  deactivateEsim,
  refreshEsim,
  setSuspended,
  sendSms,
  isCompatible,
  installDetails,
  requireInstallable,
  esimDetails,
  esimSummary,
  activationCode,
  locationFor,
} from '../domain/esims.js';
import { applyBundles } from '../domain/bundles.js';

/**
 * Routes under /esims: listing, details, lifecycle, SMS, suspension, location
 * and bundle application.
 */

/** Columns GET /esims accepts in `filterBy`. */
const FILTERABLE = ['iccid', 'customerRef', 'lastAction', 'actionDate', 'assignedDate'];

/**
 * Whether the caller asked for Apple/Android install deep links.
 *
 * @param {object} query Raw query string parameters.
 * @returns {boolean}
 */
function wantsInstallUrl(query) {
  const raw = query.additionalFields;
  const values = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return values.some((value) => String(value).trim() === 'installUrl');
}

/**
 * Pick a response format from the Accept header, the way /esims/assignments
 * does: ZIP of QR codes, JSON, or (the default) CSV.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {'zip'|'json'|'csv'}
 */
function negotiateFormat(request) {
  const accept = String(request.headers.accept ?? '').toLowerCase();
  if (accept.includes('application/zip')) return 'zip';
  if (accept.includes('application/json')) return 'json';
  return 'csv';
}

/**
 * Resolve an order or apply reference to its eSIMs.
 *
 * @param {string} reference Order reference or bundle apply reference.
 * @returns {object[]} The eSIMs created under that reference.
 * @throws {import('../util/errors.js').ApiError} 400 when the reference is unknown.
 */
function esimsForReference(reference) {
  if (!reference) throw badRequest('Missing or invalid required field: reference');
  const record = state.references.get(String(reference));
  if (!record) throw badRequest(`No eSIMs found for reference ${reference}`);
  return record.iccids.map((iccid) => state.esims.get(iccid)).filter(Boolean);
}

/**
 * Build the CSV delivered for an order reference.
 *
 * @param {object[]} esims
 * @param {{installUrl?: boolean}} [options]
 * @returns {string} CSV document.
 */
function referenceCsv(esims, options = {}) {
  const header = ['ICCID', 'Matching ID', 'RSP URL', 'Bundle'];
  if (options.installUrl) header.push('Apple Install URL', 'Android Install URL');

  const rows = [header];
  for (const esim of esims) {
    const assignment = [...state.assignments.values()].find((a) => a.iccid === esim.iccid);
    const row = [esim.iccid, esim.matchingId, esim.smdpAddress, assignment?.bundleName ?? ''];
    if (options.installUrl) {
      const details = installDetails(esim, { installUrl: true });
      row.push(details.appleInstallUrl, details.androidInstallUrl);
    }
    rows.push(row);
  }
  return toCsv(rows);
}

/**
 * ZIP archive with one QR PNG per eSIM plus the mapping CSV.
 *
 * @param {object[]} esims
 * @param {string} reference
 * @returns {Promise<Buffer>} ZIP payload.
 */
async function referenceZip(esims, reference) {
  const entries = [];
  for (const esim of esims) {
    entries.push({ name: `${esim.iccid}.png`, data: await qrPng(activationCode(esim)) });
  }
  entries.push({ name: `${reference}.csv`, data: Buffer.from(referenceCsv(esims), 'utf8') });
  return createZip(entries);
}

/**
 * Register the /esims routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function esimRoutes(app) {
  /**
   * GET /esims - list the eSIMs assigned to the organisation.
   */
  app.get('/esims', async (request) => {
    const query = request.query ?? {};
    const { page, perPage } = parsePage(query.page, query.perPage, {
      defaultPerPage: 25,
      allowed: [10, 25, 50, 100],
    });

    let esims = listEsims();

    if (query.filterBy !== undefined || query.filter !== undefined) {
      const column = String(query.filterBy ?? '');
      if (!FILTERABLE.includes(column)) {
        throw badRequest(`Invalid value for filterBy: must be one of ${FILTERABLE.join(', ')}`);
      }
      const needle = String(query.filter ?? '').toLowerCase();
      esims = esims.filter((esim) => String(esim[column] ?? '').toLowerCase().includes(needle));
    }

    const orderBy = optionalEnum(query.orderBy, 'orderBy', ['iccid'], undefined);
    if (orderBy) esims = sortBy(esims, orderBy, query.direction);

    return { esims: paginate(esims, { page, perPage }).map(esimSummary) };
  });

  /**
   * PUT /esims - update the customer reference of an eSIM.
   *
   * The live API takes `iccid` and `customerRef` as query parameters; a JSON
   * body with the same fields is accepted too.
   */
  app.put('/esims', async (request) => {
    const query = request.query ?? {};
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const iccid = query.iccid ?? body.iccid;
    const customerRef = query.customerRef ?? body.customerRef;

    requireString(iccid, 'iccid');
    if (customerRef === undefined) throw badRequest('Missing or invalid required field: customerRef');

    updateCustomerRef(iccid, String(customerRef));
    return { status: 'success' };
  });

  /**
   * POST /esims/apply - apply one or more bundles, optionally provisioning new eSIMs.
   */
  app.post('/esims/apply', async (request) => {
    const body = requireObject(request.body);
    const list = body.bundles ?? body.Bundles;
    /** @type {{name: string, repeat?: number, allowReassign?: boolean}[]} */
    let bundles;

    if (Array.isArray(list)) {
      if (list.length === 0) throw badRequest('Missing or invalid required field: bundles');
      bundles = list.map((entry) => {
        const item = requireObject(entry, 'bundle entry');
        return {
          name: requireString(item.name ?? item.Bundle, 'name'),
          repeat: optionalInt(item.repeat, 'repeat', { min: 1, max: 100 }),
          allowReassign: optionalBoolean(item.allowReassign, 'allowReassign', false),
        };
      });
    } else {
      bundles = [
        {
          name: requireString(body.name ?? body.Bundle, 'name'),
          repeat: optionalInt(body.repeat, 'repeat', { min: 1, max: 100 }),
          allowReassign: optionalBoolean(body.allowReassign, 'allowReassign', false),
        },
      ];
    }

    const iccid = body.iccid ? String(body.iccid) : undefined;
    const result = applyBundles({ iccid, bundles });
    return { esims: result.esims, applyReference: result.applyReference };
  });

  /**
   * GET /esims/assignments - install details for an order or apply reference.
   *
   * Returns a ZIP of QR codes, JSON, or CSV depending on the Accept header.
   */
  app.get('/esims/assignments', async (request, reply) => {
    const query = request.query ?? {};
    const reference = String(query.reference ?? '');
    const esims = esimsForReference(reference);
    for (const esim of esims) requireInstallable(esim);

    const format = negotiateFormat(request);
    const installUrl = wantsInstallUrl(query);

    if (format === 'zip') {
      const zip = await referenceZip(esims, reference);
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${reference}.zip"`);
      return reply.send(zip);
    }

    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv');
      return reply.send(referenceCsv(esims, { installUrl }));
    }

    const payload = esims.map((esim) => installDetails(esim, { installUrl }));
    return payload.length === 1 ? payload[0] : payload;
  });

  /**
   * GET /esims/{iccid} - full detail for one eSIM.
   */
  app.get('/esims/:iccid', async (request) => {
    const esim = requireEsim(request.params.iccid);
    return esimDetails(esim, { installUrl: wantsInstallUrl(request.query ?? {}) });
  });

  /**
   * DELETE /esims/{iccid} - deactivate an eSIM.
   */
  app.delete('/esims/:iccid', async (request) => {
    deactivateEsim(request.params.iccid);
    return { status: 'eSIM deleted successfully' };
  });

  /**
   * GET /esims/{iccid}/history - lifecycle and bundle events, newest first.
   */
  app.get('/esims/:iccid/history', async (request) => {
    const esim = requireEsim(request.params.iccid);
    return esim.history.map((entry) => ({
      name: entry.name,
      bundleName: entry.bundleName,
      date: entry.date,
      ...(entry.alertType ? { alertType: entry.alertType } : {}),
    }));
  });

  /**
   * GET /esims/{iccid}/refresh - re-push the profile to the device.
   */
  app.get('/esims/:iccid/refresh', async (request) => {
    refreshEsim(request.params.iccid);
    return { status: 'Successfully refreshed SIM' };
  });

  /**
   * GET /esims/{iccid}/compatible/{bundle} - profile compatibility check.
   */
  app.get('/esims/:iccid/compatible/:bundle', async (request) => ({
    compatible: isCompatible(request.params.iccid, request.params.bundle),
  }));

  /**
   * POST /esims/{iccid}/sms - send an SMS to the eSIM.
   */
  app.post('/esims/:iccid/sms', async (request) => {
    const body = requireObject(request.body);
    const message = requireString(body.message, 'message', { min: 1, max: 160 });
    const from = body.from === undefined ? 'eSIM' : requireString(body.from, 'from', { max: 11 });
    const record = sendSms(request.params.iccid, message, from);
    return { status: record.status };
  });

  /**
   * POST /esims/{iccid}/suspend - suspend or unsuspend an eSIM.
   */
  app.post('/esims/:iccid/suspend', async (request, reply) => {
    const body = requireObject(request.body);
    const suspend = requireBoolean(body.suspend, 'suspend');
    const { status } = setSuspended(request.params.iccid, suspend);
    return reply.code(201).send({ status });
  });

  /**
   * GET /esims/{iccid}/suspend - current suspension state.
   */
  app.get('/esims/:iccid/suspend', async (request) => {
    const esim = requireEsim(request.params.iccid);
    return { suspended: esim.state === 'suspended' };
  });

  /**
   * GET /esims/{iccid}/location - last known network and country.
   */
  app.get('/esims/:iccid/location', async (request) => {
    const location = locationFor(request.params.iccid);
    if (!location) {
      return {
        mobileNetworkCode: '',
        networkName: '',
        networkBrandName: '',
        country: '',
        lastSeen: '',
      };
    }
    return location;
  });
}

export { esimsForReference, referenceCsv, referenceZip, wantsInstallUrl };
