import { config } from '../config.js';
import { state } from '../store/state.js';
import { clock, DAY_MS } from '../util/time.js';
import { tickAssignment, activeAssignment } from '../domain/bundles.js';
import { attachToNetwork, recordHistory } from '../domain/esims.js';
import { sendEsimDeleted, sendEsimDeletionScheduled } from '../callbacks/dispatcher.js';

/**
 * Background simulation engine.
 *
 * A real eSIM platform changes state without anyone calling the API: devices
 * install profiles, attach to networks, burn data, bundles expire and idle
 * eSIMs are eventually deleted. This engine reproduces that on a timer so a
 * client integrating against the mock sees a system that moves on its own.
 *
 * Everything it does is also reachable synchronously through the /__mock
 * control plane, so tests never have to sleep.
 */

/** @type {NodeJS.Timeout|undefined} */
let timer;

/** Virtual timestamp of the previous tick, used to scale data consumption. */
let lastTickAt = clock.now();

/**
 * Auto install and attach eSIMs that have been sitting with a bundle for long
 * enough, mirroring an end user scanning the QR code.
 *
 * @param {object} esim
 * @returns {void}
 */
function maybeAutoInstall(esim) {
  const delay = config.simulation.autoInstallAfterMs;
  if (delay <= 0 || esim.state !== 'active' || esim.firstAttachmentAt) return;
  if (clock.now() - esim.createdAt < delay) return;
  const hasBundle = [...state.assignments.values()].some((a) => a.iccid === esim.iccid);
  if (!hasBundle) return;
  attachToNetwork(esim.iccid);
}

/**
 * Run the 180 day inactivity pipeline: schedule deletion, then deactivate once
 * the 7 day grace period has passed.
 *
 * @param {object} esim
 * @returns {void}
 */
function runLifecycle(esim) {
  if (esim.state === 'deactivated') return;
  const now = clock.now();
  const { inactivityDays, deletionGraceDays } = config.simulation;

  if (esim.deletionScheduledAt) {
    if (now - esim.deletionScheduledAt >= deletionGraceDays * DAY_MS) {
      esim.state = 'deactivated';
      esim.profileStatus = 'Deactivated';
      esim.deletedAt = now;
      esim.msisdnEnabled = false;
      recordHistory(esim, 'eSIM Deleted');
      void sendEsimDeleted(esim.iccid);
    }
    return;
  }

  const idleFor = now - esim.lastActivityAt;
  if (idleFor < inactivityDays * DAY_MS) return;
  // An eSIM with a live bundle is never idle, whatever the timestamps say.
  if (activeAssignment(esim.iccid)) return;

  esim.deletionScheduledAt = now;
  recordHistory(esim, 'eSIM Deletion Scheduled');
  void sendEsimDeletionScheduled(esim.iccid);
}

/**
 * Advance every assignment and eSIM by one step.
 *
 * @param {object} [options]
 * @param {boolean} [options.consume] Consume data on active bundles (default: config).
 * @param {number} [options.elapsedMs] Override the elapsed window used for usage.
 * @returns {{assignments: number, esims: number}} Counts of records visited.
 */
export function tick(options = {}) {
  const now = clock.now();
  const elapsedMs = options.elapsedMs ?? Math.max(0, now - lastTickAt);
  lastTickAt = now;

  const consumeEnabled = options.consume ?? config.simulation.autoUsage;
  const bytesPerTick = Math.round((config.simulation.bytesPerSecond * elapsedMs) / 1000);

  for (const esim of state.esims.values()) {
    maybeAutoInstall(esim);
  }

  for (const assignment of state.assignments.values()) {
    const esim = state.esims.get(assignment.iccid);
    const canUseData =
      consumeEnabled &&
      bytesPerTick > 0 &&
      esim !== undefined &&
      esim.state === 'active' &&
      esim.profileStatus === 'Installed';
    tickAssignment(assignment, { consumeBytes: canUseData ? bytesPerTick : 0 });
  }

  for (const esim of state.esims.values()) {
    runLifecycle(esim);
  }

  return { assignments: state.assignments.size, esims: state.esims.size };
}

/**
 * Start the background engine. Safe to call twice.
 *
 * @returns {void}
 */
export function start() {
  if (timer) return;
  lastTickAt = clock.now();
  timer = setInterval(() => {
    try {
      tick();
    } catch (error) {
      // A simulation hiccup must never take the API down.
      console.error('[sim] tick failed:', error);
    }
  }, config.simulation.tickMs);
  timer.unref?.();
}

/**
 * Stop the background engine.
 *
 * @returns {void}
 */
export function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

/**
 * Reset the engine's internal tick cursor, used after a state reset.
 *
 * @returns {void}
 */
export function resetEngine() {
  lastTickAt = clock.now();
}
