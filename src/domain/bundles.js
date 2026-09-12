import { state, getCatalogueBundle, assignmentsForEsim } from '../store/state.js';
import { badRequest } from '../util/errors.js';
import { clock, addDays, DAY_MS } from '../util/time.js';
import { nextAssignmentId, uuid } from '../util/ids.js';
import { config } from '../config.js';
import {
  createEsim,
  requireEsim,
  recordHistory,
  markActivity,
  isCompatible,
} from './esims.js';
import { drawStock, returnStock, addStock } from './inventory.js';
import { credit } from './organisation.js';
import {
  sendUtilisation,
  sendFirstUse,
  sendMsisdnEnabled,
  sendMsisdnDisabled,
} from '../callbacks/dispatcher.js';

/**
 * Bundle assignments: applying bundles to eSIMs, their state machine
 * (processing -> queued -> active -> depleted/expired/revoked/lapsed), usage
 * accounting and revokes.
 */

/** Utilisation callback thresholds, in percent of data consumed. */
const UTILISATION_THRESHOLDS = [1, 50, 80, 100];

/** Data is counted in base-10 bytes: 1 MB = 1,000,000 bytes. */
const MB = 1_000_000;

/** States in which an assignment still holds unconsumed value. */
const REVOCABLE_STATES = new Set(['processing', 'queued', 'active']);

/** States that are done and never transition again. */
const TERMINAL_STATES = new Set(['depleted', 'expired', 'revoked', 'lapsed']);

/**
 * Translate catalogue allowances into the per-assignment form, which counts
 * data in BYTES rather than MB.
 *
 * @param {object[]} allowances Catalogue allowances.
 * @returns {object[]} Assignment allowances.
 */
function toAssignmentAllowances(allowances) {
  return allowances.map((allowance) => {
    const amount = allowance.type === 'DATA' ? allowance.amount * MB : allowance.amount;
    return {
      type: allowance.type,
      service: allowance.service,
      description: allowance.description,
      initialAmount: amount,
      remainingAmount: amount,
      unit: allowance.type === 'DATA' ? 'BYTES' : allowance.unit,
      unlimited: allowance.unlimited,
    };
  });
}

/**
 * Whether a bundle carries voice or SMS, in which case the eSIM gets an MSISDN.
 *
 * @param {object} bundle Catalogue bundle.
 * @returns {boolean}
 */
const hasMsisdnServices = (bundle) =>
  bundle.allowances.some((allowance) => allowance.type === 'VOICE' || allowance.type === 'SMS');

/**
 * The assignment currently consuming data on an eSIM, if any.
 *
 * @param {string} iccid
 * @returns {object|undefined}
 */
export const activeAssignment = (iccid) =>
  assignmentsForEsim(iccid).find((assignment) => assignment.bundleState === 'active');

/**
 * Create one bundle assignment on an eSIM.
 *
 * The assignment starts in `processing`, exactly like the live API, and is
 * promoted by the simulation engine (or by {@link promoteAssignment}).
 *
 * @param {object} esim Target eSIM.
 * @param {object} bundle Catalogue bundle.
 * @param {object} [options]
 * @param {string} [options.reference] Apply/order reference to stamp on the assignment.
 * @param {number} [options.index] Index within a multi-bundle apply, used in the reference suffix.
 * @param {object} [options.inventoryItem] Inventory row the bundle was drawn from.
 * @returns {object} The stored assignment.
 */
export function createAssignment(esim, bundle, options = {}) {
  const now = clock.now();
  const reference = options.reference ?? uuid();
  const dataBytes = bundle.dataAmount * MB;

  const assignment = {
    id: nextAssignmentId(),
    iccid: esim.iccid,
    bundleName: bundle.name,
    callTypeGroup: 'data',
    initialQuantity: dataBytes,
    remainingQuantity: dataBytes,
    assignmentDateTime: clock.isoNano(now),
    assignmentReference: `${reference}-${options.index ?? 0}`,
    bundleState: 'processing',
    startTime: undefined,
    endTime: undefined,
    unlimited: bundle.unlimited,
    allowances: toAssignmentAllowances(bundle.allowances),
    usageId: options.inventoryItem?.usageId,
    price: bundle.price,
    activationDeadline: options.inventoryItem?.expiry
      ? new Date(`${options.inventoryItem.expiry}T23:59:59Z`).toISOString()
      : clock.iso(addDays(now, config.simulation.inventoryExpiryDays)),
    notifiedThresholds: [],
    firstUseNotified: false,
    createdAt: now,
  };

  state.assignments.set(assignment.id, assignment);
  recordHistory(esim, 'Bundle Applied', bundle.name, { bundleState: 'processing' });
  markActivity(esim);
  return assignment;
}

/**
 * Move an assignment out of `processing` once the provisioning delay has passed,
 * then start it if nothing else is running on the eSIM and the bundle autostarts
 * (or the eSIM is already on a network).
 *
 * @param {object} assignment
 * @param {{force?: boolean}} [options] `force` ignores the processing delay.
 * @returns {object} The assignment.
 */
export function promoteAssignment(assignment, options = {}) {
  if (assignment.bundleState !== 'processing') return assignment;
  const elapsed = clock.now() - assignment.createdAt;
  if (!options.force && elapsed < config.simulation.processingMs) return assignment;

  assignment.bundleState = 'queued';
  const esim = state.esims.get(assignment.iccid);
  if (!esim) return assignment;

  const bundle = getCatalogueBundle(assignment.bundleName);
  const shouldStart = bundle?.autostart || Boolean(esim.firstAttachmentAt);
  if (shouldStart && !activeAssignment(esim.iccid)) startAssignment(assignment);
  return assignment;
}

/**
 * Start an assignment: stamps the validity window and enables the MSISDN for
 * voice/SMS bundles.
 *
 * @param {object} assignment
 * @returns {object} The assignment.
 */
export function startAssignment(assignment) {
  if (assignment.bundleState === 'active' || TERMINAL_STATES.has(assignment.bundleState)) {
    return assignment;
  }
  const bundle = getCatalogueBundle(assignment.bundleName);
  const now = clock.now();
  assignment.bundleState = 'active';
  assignment.startTime = clock.iso(now);
  assignment.endTime = clock.iso(addDays(now, bundle?.duration ?? 30));

  const esim = state.esims.get(assignment.iccid);
  if (esim) {
    recordHistory(esim, 'Bundle Started', assignment.bundleName, { bundleState: 'active' });
    markActivity(esim);
    if (bundle && hasMsisdnServices(bundle) && !esim.msisdnEnabled) {
      esim.msisdnEnabled = true;
      void sendMsisdnEnabled(esim.iccid, esim.msisdn);
    }
  }
  return assignment;
}

/**
 * Start the oldest queued assignment on an eSIM, if nothing is active.
 *
 * @param {string} iccid
 * @returns {object|undefined} The assignment that was started, if any.
 */
export function startNextQueued(iccid) {
  if (activeAssignment(iccid)) return undefined;
  const queued = assignmentsForEsim(iccid)
    .filter((assignment) => assignment.bundleState === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt);
  const next = queued[0];
  return next ? startAssignment(next) : undefined;
}

/**
 * Consume data from an assignment, firing `FirstUse` and `Utilisation`
 * callbacks and depleting the bundle when it runs out.
 *
 * Unlimited bundles count down for reporting purposes but never deplete.
 *
 * @param {object} assignment
 * @param {number} bytes Bytes to consume.
 * @returns {object} The assignment.
 */
export function consume(assignment, bytes) {
  if (assignment.bundleState !== 'active' || bytes <= 0) return assignment;

  const bundle = getCatalogueBundle(assignment.bundleName);
  const esim = state.esims.get(assignment.iccid);
  const before = assignment.remainingQuantity;

  // Unlimited bundles count down too, so usage reporting stays meaningful; they
  // simply never deplete (see the guard further down).
  assignment.remainingQuantity = Math.max(0, before - bytes);

  const dataAllowance = assignment.allowances.find((allowance) => allowance.type === 'DATA');
  if (dataAllowance) dataAllowance.remainingAmount = assignment.remainingQuantity;

  if (esim) {
    markActivity(esim);
    if (!esim.firstUseAt) {
      esim.firstUseAt = clock.now();
      recordHistory(esim, 'eSIM First Use', assignment.bundleName);
    }
  }

  if (!assignment.firstUseNotified) {
    assignment.firstUseNotified = true;
    void sendFirstUse(assignment, bundle);
  }

  notifyUtilisation(assignment, bundle);

  if (!assignment.unlimited && assignment.remainingQuantity === 0) {
    deplete(assignment);
  }
  return assignment;
}

/**
 * Fire a `Utilisation` callback for every threshold newly crossed.
 *
 * @param {object} assignment
 * @param {object} [bundle] Catalogue bundle, for the description field.
 * @returns {void}
 */
function notifyUtilisation(assignment, bundle) {
  if (assignment.initialQuantity <= 0) return;
  const usedPercent =
    ((assignment.initialQuantity - assignment.remainingQuantity) / assignment.initialQuantity) * 100;

  for (const threshold of UTILISATION_THRESHOLDS) {
    if (usedPercent >= threshold && !assignment.notifiedThresholds.includes(threshold)) {
      assignment.notifiedThresholds.push(threshold);
      const esim = state.esims.get(assignment.iccid);
      if (esim) {
        recordHistory(esim, 'eSIM Utilisation Alert', assignment.bundleName, {
          alertType: `${threshold}%`,
        });
      }
      void sendUtilisation(assignment, bundle);
    }
  }
}

/**
 * Mark an assignment depleted (all data used, still inside its validity window).
 *
 * @param {object} assignment
 * @returns {object} The assignment.
 */
export function deplete(assignment) {
  assignment.bundleState = 'depleted';
  const esim = state.esims.get(assignment.iccid);
  if (esim) {
    recordHistory(esim, 'Bundle Depleted', assignment.bundleName, { bundleState: 'depleted' });
    disableMsisdnIfNeeded(esim, assignment, 'Bundle depleted');
  }
  startNextQueued(assignment.iccid);
  return assignment;
}

/**
 * Mark an assignment expired (validity window passed).
 *
 * @param {object} assignment
 * @returns {object} The assignment.
 */
export function expire(assignment) {
  assignment.bundleState = 'expired';
  const esim = state.esims.get(assignment.iccid);
  if (esim) {
    recordHistory(esim, 'Bundle Expired', assignment.bundleName, { bundleState: 'expired' });
    disableMsisdnIfNeeded(esim, assignment, 'Bundle expired');
  }
  startNextQueued(assignment.iccid);
  return assignment;
}

/**
 * Mark an assignment lapsed: it expired without ever being started.
 *
 * @param {object} assignment
 * @returns {object} The assignment.
 */
export function lapse(assignment) {
  assignment.bundleState = 'lapsed';
  const esim = state.esims.get(assignment.iccid);
  if (esim) recordHistory(esim, 'Bundle Lapsed', assignment.bundleName, { bundleState: 'lapsed' });
  return assignment;
}

/**
 * Drop the MSISDN when the bundle that provided voice/SMS is gone and no other
 * voice/SMS bundle is live.
 *
 * @param {object} esim
 * @param {object} assignment The assignment that just ended.
 * @param {'Bundle expired'|'Bundle revoked'|'Bundle depleted'} reason
 * @returns {void}
 */
function disableMsisdnIfNeeded(esim, assignment, reason) {
  if (!esim.msisdnEnabled) return;
  const bundle = getCatalogueBundle(assignment.bundleName);
  if (!bundle || !hasMsisdnServices(bundle)) return;

  const stillLive = assignmentsForEsim(esim.iccid).some((other) => {
    if (other.id === assignment.id) return false;
    if (!['active', 'queued', 'processing'].includes(other.bundleState)) return false;
    const otherBundle = getCatalogueBundle(other.bundleName);
    return Boolean(otherBundle && hasMsisdnServices(otherBundle));
  });
  if (stillLive) return;

  esim.msisdnEnabled = false;
  void sendMsisdnDisabled(esim.iccid, esim.msisdn, reason);
}

/**
 * Look up a catalogue bundle or fail with the live API's error.
 *
 * @param {string} name Bundle name (case sensitive).
 * @returns {object} Catalogue bundle.
 * @throws {import('../util/errors.js').ApiError} 400 when unknown.
 */
export function requireBundle(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw badRequest('Missing or invalid required field: name');
  }
  const bundle = getCatalogueBundle(name);
  if (!bundle) throw badRequest(`Bundle ${name} does not exist`);
  return bundle;
}

/**
 * Reserve one unit of a bundle: from inventory when stock exists, otherwise by
 * charging the organisation balance (what the live API calls an auto-purchase).
 *
 * @param {object} bundle Catalogue bundle.
 * @returns {object|undefined} The inventory row used, when drawn from stock.
 */
function reserveBundle(bundle) {
  const item = drawStock(bundle.name);
  if (item) return item;
  throw badRequest(
    `No ${bundle.name} bundles available in your inventory. Order the bundle first, or apply it through POST /orders with assign set to true.`,
  );
}

/**
 * Apply bundles to eSIMs (POST /esims/apply).
 *
 * Three shapes are supported, matching the live API:
 * - a single bundle onto a known ICCID;
 * - a single bundle with `repeat`, creating that many new eSIMs;
 * - a list of bundles, each with its own `repeat`.
 *
 * @param {object} request
 * @param {string} [request.iccid] Target eSIM; omit to provision a new one.
 * @param {{name: string, repeat?: number, allowReassign?: boolean}[]} request.bundles Bundles to apply.
 * @param {string} [request.reference] Reference to use instead of a fresh UUID.
 * @returns {{applyReference: string, esims: {iccid: string, status: string, bundle: string}[]}}
 */
export function applyBundles(request) {
  const reference = request.reference ?? uuid();
  const results = [];
  let index = 0;

  for (const entry of request.bundles) {
    const bundle = requireBundle(entry.name);
    const repeat = entry.repeat ?? 1;

    if (request.iccid && repeat > 1) {
      throw badRequest('The repeat parameter cannot be combined with an ICCID');
    }

    for (let i = 0; i < repeat; i += 1) {
      let esim;
      if (request.iccid) {
        esim = requireEsim(request.iccid);
        if (esim.state === 'deactivated') {
          throw badRequest('Bundles cannot be applied to a deactivated eSIM');
        }
        if (!entry.allowReassign && !isCompatible(esim.iccid, bundle.name)) {
          throw badRequest(
            `Bundle ${bundle.name} is not compatible with eSIM ${esim.iccid}. Set allowReassign to true to assign a new profile.`,
          );
        }
      } else {
        esim = createEsim({ profileName: bundle.profileName });
        esim.applyReference = reference;
      }

      const item = reserveBundle(bundle);
      createAssignment(esim, bundle, { reference, index, inventoryItem: item });
      results.push({ iccid: esim.iccid, status: 'ACTIVE', bundle: bundle.name });
      index += 1;
    }
  }

  state.references.set(reference, {
    reference,
    kind: 'apply',
    iccids: results.map((r) => r.iccid),
    bundleNames: [...new Set(results.map((r) => r.bundle))],
    createdAt: clock.now(),
  });

  return { applyReference: reference, esims: results };
}

/**
 * Wire format for one assignment.
 *
 * @param {object} assignment
 * @returns {object} Assignment payload.
 */
export const assignmentPayload = (assignment) => ({
  id: assignment.id,
  callTypeGroup: assignment.callTypeGroup,
  initialQuantity: assignment.initialQuantity,
  remainingQuantity: assignment.remainingQuantity,
  assignmentDateTime: assignment.assignmentDateTime,
  assignmentReference: assignment.assignmentReference,
  bundleState: assignment.bundleState,
  ...(assignment.startTime ? { startTime: assignment.startTime } : {}),
  ...(assignment.endTime ? { endTime: assignment.endTime } : {}),
  unlimited: assignment.unlimited,
  allowances: assignment.allowances,
});

/**
 * GET /esims/{iccid}/bundles payload.
 *
 * @param {string} iccid
 * @param {{includeUsed?: boolean, limit?: number}} [options]
 * @returns {{bundles: object[]}} Bundles grouped by name, newest assignment first.
 */
export function bundlesForEsimPayload(iccid, options = {}) {
  const { includeUsed = false, limit = 15 } = options;
  const assignments = assignmentsForEsim(iccid)
    .filter((assignment) => (includeUsed ? true : !TERMINAL_STATES.has(assignment.bundleState)))
    .slice(0, limit);

  /** @type {Map<string, object>} */
  const grouped = new Map();
  for (const assignment of assignments) {
    if (!grouped.has(assignment.bundleName)) {
      const bundle = getCatalogueBundle(assignment.bundleName);
      grouped.set(assignment.bundleName, {
        name: assignment.bundleName,
        description: bundle?.description ?? assignment.bundleName,
        assignments: [],
      });
    }
    grouped.get(assignment.bundleName).assignments.push(assignmentPayload(assignment));
  }
  return { bundles: [...grouped.values()] };
}

/**
 * GET /esims/{iccid}/bundles/{name} payload.
 *
 * @param {string} iccid
 * @param {string} name Bundle name.
 * @returns {{assignments: object[]}} Every assignment of that bundle on the eSIM.
 */
export function bundleStatusPayload(iccid, name) {
  const assignments = assignmentsForEsim(iccid)
    .filter((assignment) => assignment.bundleName === name)
    .map(assignmentPayload);
  return { assignments };
}

/**
 * Find the assignment a revoke request refers to.
 *
 * @param {string} iccid
 * @param {string} name Bundle name.
 * @param {string} [assignmentId] Specific assignment (`offerId` on some routes).
 * @returns {object} The assignment.
 * @throws {import('../util/errors.js').ApiError} 400 when there is nothing to revoke.
 */
export function findRevocable(iccid, name, assignmentId) {
  const assignments = assignmentsForEsim(iccid).filter((a) => a.bundleName === name);
  if (assignments.length === 0) {
    throw badRequest(`Bundle ${name} is not assigned to eSIM ${iccid}`);
  }

  if (assignmentId) {
    const match = assignments.find((a) => a.id === String(assignmentId));
    if (!match) throw badRequest(`Assignment ${assignmentId} not found for bundle ${name}`);
    if (!REVOCABLE_STATES.has(match.bundleState)) {
      throw badRequest(`Assignment ${assignmentId} is ${match.bundleState} and cannot be revoked`);
    }
    return match;
  }

  // Without an id the live API revokes the latest revocable assignment.
  const match = assignments.find((a) => REVOCABLE_STATES.has(a.bundleState));
  if (!match) throw badRequest(`No revocable assignment of ${name} found on eSIM ${iccid}`);
  return match;
}

/**
 * Describe what a revoke would do, without doing it (`type=validate`).
 *
 * @param {object} assignment
 * @param {boolean} refundToBalance
 * @returns {{status: string}} Wire format status message.
 */
export function validateRevoke(assignment, refundToBalance) {
  const untouched = assignment.remainingQuantity === assignment.initialQuantity;
  if (!untouched) {
    return {
      status: `Bundle ${assignment.bundleName} can be revoked from eSIM ${assignment.iccid}, no refund applicable because data has been used`,
    };
  }
  return {
    status: `Bundle ${assignment.bundleName} can be revoked from eSIM ${assignment.iccid} and will be refunded to ${refundToBalance ? 'balance' : 'inventory'}`,
  };
}

/**
 * Revoke an assignment, refunding it to inventory or to the balance when it is
 * still unused.
 *
 * @param {object} assignment
 * @param {{refundToBalance?: boolean}} [options]
 * @returns {{status: string}} Wire format status message.
 */
export function revokeAssignment(assignment, options = {}) {
  const untouched = assignment.remainingQuantity === assignment.initialQuantity;
  assignment.bundleState = 'revoked';
  assignment.revokedAt = clock.iso();

  const esim = state.esims.get(assignment.iccid);
  if (esim) {
    recordHistory(esim, 'Bundle Revoked', assignment.bundleName, { bundleState: 'revoked' });
    disableMsisdnIfNeeded(esim, assignment, 'Bundle revoked');
  }

  let status = 'Successfully Revoked Bundle';
  if (untouched && options.refundToBalance) {
    credit(assignment.price);
    assignment.refundedTo = 'balance';
    if (esim) recordHistory(esim, 'Bundle Refunded To Balance', assignment.bundleName);
    status = 'Successfully Revoked Bundle, bundle has been refunded to balance';
  } else if (untouched) {
    returnStock(assignment.bundleName, assignment.usageId, assignment.price);
    assignment.refundedTo = 'inventory';
    if (esim) recordHistory(esim, 'Bundle Refunded to Inventory', assignment.bundleName);
    status = 'Successfully Revoked Bundle, bundle has been refunded to inventory';
  } else {
    status = 'Successfully Revoked Bundle, no refund applicable';
  }

  startNextQueued(assignment.iccid);
  return { status };
}

/**
 * Bundle stock straight into inventory, used by orders placed with
 * `assign: false`.
 *
 * @param {object} bundle Catalogue bundle.
 * @param {number} quantity
 * @param {string} orderReference
 * @returns {object} The inventory row.
 */
export const stockBundle = (bundle, quantity, orderReference) =>
  addStock(bundle.name, quantity, bundle.price, orderReference);

/**
 * Drive one tick of the assignment state machine for a single assignment:
 * processing promotion, expiry, lapsing and (optionally) data consumption.
 *
 * @param {object} assignment
 * @param {{consumeBytes?: number}} [options] Bytes to consume when the assignment is active.
 * @returns {object} The assignment.
 */
export function tickAssignment(assignment, options = {}) {
  if (TERMINAL_STATES.has(assignment.bundleState)) return assignment;
  const now = clock.now();

  if (assignment.bundleState === 'processing') {
    promoteAssignment(assignment);
    return assignment;
  }

  if (assignment.bundleState === 'queued') {
    if (assignment.activationDeadline && Date.parse(assignment.activationDeadline) <= now) {
      return lapse(assignment);
    }
    startNextQueued(assignment.iccid);
    return assignment;
  }

  if (assignment.bundleState === 'active') {
    if (assignment.endTime && Date.parse(assignment.endTime) <= now) return expire(assignment);
    if (options.consumeBytes) consume(assignment, options.consumeBytes);
  }
  return assignment;
}

/** Exported for the simulation engine and tests. */
export const constants = { MB, DAY_MS, UTILISATION_THRESHOLDS, TERMINAL_STATES, REVOCABLE_STATES };
