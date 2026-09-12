import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { state, resetState, persist, restore, snapshot, availableInventory } from '../store/state.js';
import { clock } from '../util/time.js';
import { requireObject, requireString, optionalInt, optionalBoolean } from '../util/validate.js';
import { badRequest } from '../util/errors.js';
import {
  requireEsim,
  markInstalled,
  attachToNetwork,
  policySuspend,
  createEsim,
} from '../domain/esims.js';
import { activeAssignment, consume, promoteAssignment, startAssignment, requireBundle } from '../domain/bundles.js';
import { addStock } from '../domain/inventory.js';
import { seedAll } from '../store/seed.js';
import { tick, resetEngine } from '../sim/engine.js';
import { addFailure, removeFailure } from '../plugins/failures.js';
import { resetRateLimits } from '../plugins/ratelimit.js';
import * as callbacks from '../callbacks/dispatcher.js';

/**
 * The control plane: endpoints that exist only in the mock.
 *
 * They let a test suite drive everything the live platform would do on its own
 * (installs, attachments, data usage, clock movement) and inspect what the mock
 * sent out, without ever sleeping or waiting for the background engine.
 *
 * Mounted at /__mock, outside the versioned API prefix.
 */

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Register the control plane routes.
 *
 * @param {import('fastify').FastifyInstance} app
 * @returns {Promise<void>}
 */
export default async function mockRoutes(app) {
  /**
   * GET /__mock/health - liveness probe.
   */
  app.get('/health', async () => ({
    status: 'ok',
    api: 'eSIM Go v2.5 (mock)',
    basePath: config.basePath,
    now: clock.iso(),
    clockOffsetMs: clock.offset,
  }));

  /**
   * GET /__mock/state - counts and a compact view of everything held in memory.
   */
  app.get('/state', async () => ({
    now: clock.iso(),
    clockOffsetMs: clock.offset,
    counts: {
      catalogue: state.catalogue.length,
      esims: state.esims.size,
      assignments: state.assignments.size,
      inventoryRows: state.inventory.size,
      inventoryAvailable: availableInventory().reduce((sum, row) => sum + row.remaining, 0),
      orders: state.orders.size,
      references: state.references.size,
      callbacks: state.callbackLog.length,
      sms: state.smsLog.length,
      failures: state.failures.length,
    },
    organisation: {
      name: state.organisation.name,
      balance: state.organisation.balance,
      currency: state.organisation.currency,
      callbackUrl: state.organisation.callbackUrl,
      callbackVersion: state.organisation.callbackVersion,
    },
  }));

  /**
   * GET /__mock/state/dump - the full serialisable state.
   */
  app.get('/state/dump', async () => snapshot());

  /**
   * POST /__mock/reset - throw everything away and start again.
   *
   * Body: `{ "seed": true }` to recreate the demo data (default true).
   */
  app.post('/reset', async (request) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const withSeed = optionalBoolean(body.seed, 'seed', true);
    resetState();
    resetEngine();
    resetRateLimits();
    const seeded = withSeed ? seedAll() : { inventory: 0, esims: 0 };
    return { status: 'reset', seeded };
  });

  /**
   * GET /__mock/clock - the virtual clock.
   */
  app.get('/clock', async () => ({ now: clock.iso(), offsetMs: clock.offset }));

  /**
   * POST /__mock/clock - move the virtual clock forward.
   *
   * Body accepts `ms`, `seconds`, `minutes`, `hours` or `days`; pass
   * `{ "reset": true }` to jump back to real time.
   */
  app.post('/clock', async (request) => {
    const body = requireObject(request.body);
    if (body.reset) {
      clock.reset();
      resetEngine();
      return { now: clock.iso(), offsetMs: clock.offset };
    }
    const ms =
      (optionalInt(body.ms, 'ms') ?? 0) +
      (optionalInt(body.seconds, 'seconds') ?? 0) * 1000 +
      (optionalInt(body.minutes, 'minutes') ?? 0) * 60_000 +
      (optionalInt(body.hours, 'hours') ?? 0) * 3_600_000 +
      (optionalInt(body.days, 'days') ?? 0) * 86_400_000;
    if (ms === 0) throw badRequest('Provide one of ms, seconds, minutes, hours, days or reset');
    clock.advanceMs(ms);
    return { now: clock.iso(), offsetMs: clock.offset };
  });

  /**
   * POST /__mock/tick - run the simulation engine synchronously.
   *
   * Body: `{ "consume": true, "elapsedMs": 60000 }`.
   */
  app.post('/tick', async (request) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const result = tick({
      consume: optionalBoolean(body.consume, 'consume', undefined),
      elapsedMs: optionalInt(body.elapsedMs, 'elapsedMs', { min: 0 }),
    });
    return { status: 'ticked', ...result };
  });

  /**
   * POST /__mock/esims - provision bare eSIMs with no bundle.
   */
  app.post('/esims', async (request) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const count = optionalInt(body.count, 'count', { min: 1, max: 100 }) ?? 1;
    const created = [];
    for (let i = 0; i < count; i += 1) {
      created.push(
        createEsim({
          customerRef: body.customerRef ? String(body.customerRef) : '',
          profileName: body.profileName ? String(body.profileName) : 'Profile 1',
          physical: Boolean(body.physical),
        }).iccid,
      );
    }
    return { iccids: created };
  });

  /**
   * POST /__mock/esims/{iccid}/install - mark the profile as installed.
   */
  app.post('/esims/:iccid/install', async (request) => {
    const esim = markInstalled(request.params.iccid);
    return { iccid: esim.iccid, profileStatus: esim.profileStatus };
  });

  /**
   * POST /__mock/esims/{iccid}/attach - register on a network.
   *
   * Body: `{ "iso": "FR" }`; omit to use the bundle's first covered country.
   * Fires `FirstAttachment` once and `CountryChange` on every country change.
   */
  app.post('/esims/:iccid/attach', async (request) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const esim = attachToNetwork(request.params.iccid, body.iso);
    return { iccid: esim.iccid, location: esim.location };
  });

  /**
   * POST /__mock/esims/{iccid}/usage - burn data on the active bundle.
   *
   * Body: `{ "bytes": 5000000 }` or `{ "mb": 250 }`.
   */
  app.post('/esims/:iccid/usage', async (request) => {
    const body = requireObject(request.body);
    const bytes = (optionalInt(body.bytes, 'bytes', { min: 1 }) ?? 0) ||
      (optionalInt(body.mb, 'mb', { min: 1 }) ?? 0) * 1_000_000;
    if (!bytes) throw badRequest('Provide bytes or mb');

    const esim = requireEsim(request.params.iccid);
    let assignment = activeAssignment(esim.iccid);
    if (!assignment) {
      // Fast-forward provisioning so usage can be simulated straight after an order.
      for (const candidate of [...state.assignments.values()].filter((a) => a.iccid === esim.iccid)) {
        promoteAssignment(candidate, { force: true });
      }
      assignment = activeAssignment(esim.iccid);
      if (!assignment) {
        const queued = [...state.assignments.values()].find(
          (a) => a.iccid === esim.iccid && a.bundleState === 'queued',
        );
        if (queued) assignment = startAssignment(queued);
      }
    }
    if (!assignment) throw badRequest(`eSIM ${esim.iccid} has no bundle that can consume data`);

    consume(assignment, bytes);
    return {
      iccid: esim.iccid,
      bundle: assignment.bundleName,
      bundleState: assignment.bundleState,
      initialQuantity: assignment.initialQuantity,
      remainingQuantity: assignment.remainingQuantity,
    };
  });

  /**
   * POST /__mock/esims/{iccid}/policy-suspend - suspend the way eSIM Go's policy
   * engine does, producing an eSIM that cannot be unsuspended through the API.
   */
  app.post('/esims/:iccid/policy-suspend', async (request) => {
    const esim = policySuspend(request.params.iccid);
    return { iccid: esim.iccid, state: esim.state, suspendedBy: esim.suspendedBy };
  });

  /**
   * POST /__mock/esims/{iccid}/idle - backdate the activity clock so the
   * inactivity/deletion pipeline can be exercised.
   *
   * Body: `{ "days": 181 }`.
   */
  app.post('/esims/:iccid/idle', async (request) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const days = optionalInt(body.days, 'days', { min: 1 }) ?? config.simulation.inactivityDays + 1;
    const esim = requireEsim(request.params.iccid);
    esim.lastActivityAt = clock.now() - days * 86_400_000;
    return { iccid: esim.iccid, lastActivityAt: clock.iso(esim.lastActivityAt) };
  });

  /**
   * POST /__mock/inventory - add stock without placing an order.
   *
   * Body: `{ "name": "esim_1GB_7D_GB_V2", "quantity": 10 }`.
   */
  app.post('/inventory', async (request) => {
    const body = requireObject(request.body);
    const bundle = requireBundle(requireString(body.name, 'name'));
    const quantity = optionalInt(body.quantity, 'quantity', { min: 1, max: 10_000 }) ?? 1;
    const row = addStock(bundle.name, quantity, bundle.price);
    return { usageId: row.usageId, name: row.bundleName, remaining: row.remaining, expiry: row.expiry };
  });

  /**
   * PATCH /__mock/organisation - change organisation fields (balance, callback
   * URL, thresholds) without going through the API.
   */
  app.patch('/organisation', async (request) => {
    const body = requireObject(request.body);
    const allowed = [
      'name',
      'balance',
      'testCredit',
      'currency',
      'callbackUrl',
      'callbackVersion',
      'lowBalanceThreshold',
      'notes',
    ];
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.includes(key)) throw badRequest(`Field ${key} cannot be patched`);
      state.organisation[key] = value;
    }
    return state.organisation;
  });

  /**
   * GET /__mock/callbacks - every callback the mock tried to deliver.
   *
   * Filter with `?event=Utilisation` and cap with `?limit=50`.
   */
  app.get('/callbacks', async (request) => {
    const query = request.query ?? {};
    let entries = [...state.callbackLog].reverse();
    if (query.event) entries = entries.filter((entry) => entry.event === String(query.event));
    const limit = optionalInt(query.limit, 'limit', { min: 1, max: 500 }) ?? 100;
    return { callbacks: entries.slice(0, limit) };
  });

  /**
   * DELETE /__mock/callbacks - clear the callback log.
   */
  app.delete('/callbacks', async () => {
    const cleared = state.callbackLog.length;
    state.callbackLog.length = 0;
    return { cleared };
  });

  /**
   * POST /__mock/callbacks/config - set the callback URL and version.
   *
   * Body: `{ "url": "http://localhost:4000/hook", "version": "V3" }`.
   */
  app.post('/callbacks/config', async (request) => {
    const body = requireObject(request.body);
    if (body.url !== undefined) state.organisation.callbackUrl = String(body.url);
    if (body.version !== undefined) {
      const version = String(body.version).toUpperCase();
      if (!['V2', 'V3'].includes(version)) throw badRequest('version must be V2 or V3');
      state.organisation.callbackVersion = version;
    }
    return {
      callbackUrl: state.organisation.callbackUrl,
      callbackVersion: state.organisation.callbackVersion,
    };
  });

  /**
   * POST /__mock/callbacks/test - send one callback of any supported type.
   *
   * Body: `{ "event": "Utilisation", "iccid": "89...", "payload": { ... } }`.
   * With no event, every event type is fired once against the first eSIM.
   */
  app.post('/callbacks/test', async (request) => {
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    const iccid = body.iccid ? String(body.iccid) : [...state.esims.keys()][0];
    const esim = iccid ? state.esims.get(iccid) : undefined;
    const assignment = esim ? activeAssignment(esim.iccid) : undefined;

    /** @type {Record<string, () => Promise<object>>} */
    const senders = {
      Utilisation: () =>
        assignment
          ? callbacks.sendUtilisation(assignment)
          : callbacks.dispatch('Utilisation', body.payload ?? { iccid, alertType: 'Utilisation' }),
      FirstUse: () =>
        assignment
          ? callbacks.sendFirstUse(assignment)
          : callbacks.dispatch('FirstUse', body.payload ?? { iccid, alertType: 'FirstUse' }),
      FirstAttachment: () => callbacks.sendFirstAttachment(iccid),
      CountryChange: () => callbacks.sendLocationUpdate(iccid, { iso: 'NO', name: 'Norway' }),
      Topup: () => callbacks.sendTopup(state.organisation.balance, state.organisation.balance + 100),
      LowBalance: () =>
        callbacks.sendBalanceThreshold(state.organisation.balance, state.organisation.lowBalanceThreshold),
      'esim.deletion_scheduled': () => callbacks.sendEsimDeletionScheduled(iccid),
      'esim.deleted': () => callbacks.sendEsimDeleted(iccid),
      MSISDNEnabled: () => callbacks.sendMsisdnEnabled(iccid, esim?.msisdn ?? '447000000000'),
      MSISDNDisabled: () =>
        callbacks.sendMsisdnDisabled(iccid, esim?.msisdn ?? '447000000000', 'Bundle expired'),
      SMSFailed: () => callbacks.sendSmsFailed(iccid, esim?.msisdn),
    };

    if (body.event) {
      const sender = senders[String(body.event)];
      if (!sender) {
        throw badRequest(`Unknown event ${body.event}. Supported: ${Object.keys(senders).join(', ')}`);
      }
      return { sent: [await sender()] };
    }

    const sent = [];
    for (const sender of Object.values(senders)) sent.push(await sender());
    return { sent };
  });

  /**
   * GET /__mock/sms - every SMS submitted through the API.
   */
  app.get('/sms', async () => ({ sms: [...state.smsLog].reverse() }));

  /**
   * GET /__mock/failures - armed failure rules.
   */
  app.get('/failures', async () => ({ failures: state.failures }));

  /**
   * POST /__mock/failures - arm a failure rule.
   *
   * Body: `{ "path": "/orders", "method": "POST", "status": 503,
   * "message": "Processing", "count": 2, "delayMs": 100 }`.
   */
  app.post('/failures', async (request) => {
    const body = requireObject(request.body);
    return addFailure({
      path: body.path ? String(body.path) : '*',
      method: body.method,
      status: optionalInt(body.status, 'status', { min: 100, max: 599 }) ?? 500,
      message: body.message ? String(body.message) : 'Server Error',
      count: optionalInt(body.count, 'count', { min: 1 }),
      delayMs: optionalInt(body.delayMs, 'delayMs', { min: 0, max: 60_000 }),
    });
  });

  /**
   * DELETE /__mock/failures - clear every rule.
   */
  app.delete('/failures', async () => ({ removed: removeFailure() }));

  /**
   * DELETE /__mock/failures/{id} - clear one rule.
   */
  app.delete('/failures/:id', async (request) => ({ removed: removeFailure(request.params.id) }));

  /**
   * POST /__mock/persist - write the state to STATE_PATH.
   */
  app.post('/persist', async () => ({ persisted: persist(), path: config.statePath || null }));

  /**
   * POST /__mock/restore - reload the state from STATE_PATH.
   */
  app.post('/restore', async () => ({ restored: restore(), path: config.statePath || null }));

  /**
   * GET /__mock/openapi.yaml - the upstream eSIM Go v2.5 OpenAPI document this
   * mock was built from.
   */
  app.get('/openapi.yaml', async (_request, reply) => {
    const file = join(here, '..', '..', 'openapi', 'esim_go_schema_v2_5.yaml');
    reply.header('Content-Type', 'application/yaml');
    return reply.send(readFileSync(file, 'utf8'));
  });
}
