import { createHmac, randomUUID } from 'node:crypto';
import { state } from '../store/state.js';
import { clock } from '../util/time.js';

/**
 * Outbound webhook ("callback") delivery.
 *
 * eSIM Go posts usage and lifecycle events to the callback URL configured on
 * the organisation. V3 signs the raw body with HMAC-SHA256 using the API key
 * and sends it in `X-Signature-SHA256`; V2 sends no signature and a slimmer
 * bundle object. Both are reproduced here.
 *
 * Every attempt is appended to `state.callbackLog`, so the mock is still useful
 * (and assertable) when no callback URL is configured at all.
 */

/** Maximum callback attempts retained in memory. */
const LOG_LIMIT = 500;

/** How long to wait for the receiver before giving up. */
const TIMEOUT_MS = 5000;

/**
 * HMAC-SHA256 signature of a raw body, base64 encoded.
 *
 * @param {string} rawBody Exact bytes that will be sent.
 * @param {string} apiKey Signing key (the organisation API key).
 * @returns {string} Base64 signature.
 */
export function signBody(rawBody, apiKey) {
  return createHmac('sha256', apiKey).update(rawBody).digest('base64');
}

/**
 * Record an attempt in the in-memory callback log.
 *
 * @param {object} entry Partial log entry.
 * @returns {object} The stored entry.
 */
function log(entry) {
  const record = { id: randomUUID(), at: clock.iso(), ...entry };
  state.callbackLog.push(record);
  if (state.callbackLog.length > LOG_LIMIT) state.callbackLog.splice(0, state.callbackLog.length - LOG_LIMIT);
  return record;
}

/**
 * Deliver one callback. Never throws: delivery problems are recorded on the log
 * entry instead, mirroring a fire-and-forget webhook sender.
 *
 * @param {string} event Event name, e.g. `Utilisation` or `esim.deleted`.
 * @param {object} body JSON body to POST.
 * @returns {Promise<object>} The log entry describing the attempt.
 */
export async function dispatch(event, body) {
  const org = state.organisation;
  const version = org.callbackVersion === 'V2' ? 'V2' : 'V3';
  const raw = JSON.stringify(body);
  const signature = version === 'V3' ? signBody(raw, org.apiKey) : undefined;

  if (!org.callbackUrl) {
    return log({ event, url: '', version, signature, body, delivered: false, error: 'no callbackUrl configured' });
  }

  const entry = log({ event, url: org.callbackUrl, version, signature, body, delivered: false });

  try {
    const response = await fetch(org.callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signature ? { 'X-Signature-SHA256': signature } : {}),
      },
      body: raw,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    entry.responseStatus = response.status;
    entry.delivered = response.ok;
    if (!response.ok) entry.error = `receiver responded ${response.status}`;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
  }

  return entry;
}

/**
 * Shape the `bundle` object of a usage callback for the configured version.
 *
 * @param {object} assignment Bundle assignment.
 * @param {object} [bundle] Catalogue bundle, used for the description.
 * @returns {object} V2 or V3 bundle payload.
 */
function usageBundle(assignment, bundle) {
  const base = {
    name: assignment.bundleName,
    initialQuantity: assignment.initialQuantity,
    remainingQuantity: assignment.remainingQuantity,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
  };
  if (state.organisation.callbackVersion === 'V2') return base;
  return {
    id: assignment.id,
    reference: assignment.assignmentReference,
    name: assignment.bundleName,
    description: bundle?.description ?? assignment.bundleName,
    initialQuantity: assignment.initialQuantity,
    remainingQuantity: assignment.remainingQuantity,
    startTime: assignment.startTime,
    endTime: assignment.endTime,
    unlimited: assignment.unlimited,
  };
}

/**
 * `Utilisation` - data used crossed one of the 1/50/80/100% thresholds.
 *
 * @param {object} assignment
 * @param {object} [bundle] Catalogue bundle for the description field.
 * @returns {Promise<object>}
 */
export const sendUtilisation = (assignment, bundle) =>
  dispatch('Utilisation', {
    iccid: assignment.iccid,
    alertType: 'Utilisation',
    bundle: { ...usageBundle(assignment, bundle), unit: 'BYTES' },
  });

/**
 * `FirstUse` - the eSIM consumed data on a bundle for the first time.
 *
 * @param {object} assignment
 * @param {object} [bundle]
 * @returns {Promise<object>}
 */
export const sendFirstUse = (assignment, bundle) =>
  dispatch('FirstUse', {
    iccid: assignment.iccid,
    alertType: 'FirstUse',
    bundle: usageBundle(assignment, bundle),
  });

/**
 * `FirstAttachment` - the eSIM registered on a mobile network for the first time.
 *
 * @param {string} iccid
 * @returns {Promise<object>}
 */
export const sendFirstAttachment = (iccid) =>
  dispatch('FirstAttachment', { alertType: 'FirstAttachment', iccid });

/**
 * `CountryChange` - the eSIM registered in a different country.
 *
 * @param {string} iccid
 * @param {{iso: string, name: string}} country
 * @returns {Promise<object>}
 */
export const sendLocationUpdate = (iccid, country) =>
  dispatch('CountryChange', {
    alertType: 'CountryChange',
    iccid,
    country: { code: country.iso, name: country.name },
  });

/**
 * `Topup` - the organisation balance was topped up.
 *
 * @param {number} oldAmount Balance before the top-up.
 * @param {number} newAmount Balance after the top-up.
 * @param {'Topup'|'AutoTopup'|'eSIMGoTopup'} [alertType]
 * @returns {Promise<object>}
 */
export const sendTopup = (oldAmount, newAmount, alertType = 'Topup') =>
  dispatch('Topup', { alertType, bundle: { oldAmount, newAmount } });

/**
 * `LowBalance` / `InsufficientBalance` - balance crossed the configured threshold.
 *
 * @param {number} balance Current balance.
 * @param {number} threshold Configured low balance threshold.
 * @returns {Promise<object>}
 */
export function sendBalanceThreshold(balance, threshold) {
  const alertType = balance <= 0 ? 'InsufficientBalance' : 'LowBalance';
  const thresholdPercentRemaining =
    threshold > 0 ? Math.round((balance / threshold) * 100000) / 1000 : 0;
  return dispatch(alertType, {
    alertType,
    balanceInfo: { balance, threshold, thresholdPercentRemaining },
  });
}

/**
 * `esim.deletion_scheduled` - eSIM flagged for deletion after inactivity.
 *
 * @param {string} iccid
 * @returns {Promise<object>}
 */
export const sendEsimDeletionScheduled = (iccid) =>
  dispatch('esim.deletion_scheduled', {
    date: clock.iso().replace(/\.\d{3}Z$/, 'Z'),
    event: 'esim.deletion_scheduled',
    iccid,
  });

/**
 * `esim.deleted` - eSIM permanently deactivated at network level.
 *
 * @param {string} iccid
 * @returns {Promise<object>}
 */
export const sendEsimDeleted = (iccid) =>
  dispatch('esim.deleted', {
    date: clock.iso().replace(/\.\d{3}Z$/, 'Z'),
    event: 'esim.deleted',
    iccid,
  });

/**
 * `MSISDNEnabled` - a voice/SMS capable bundle was added to the eSIM.
 *
 * @param {string} iccid
 * @param {string} msisdn
 * @param {string} [reason]
 * @returns {Promise<object>}
 */
export const sendMsisdnEnabled = (iccid, msisdn, reason = 'Bundle added') =>
  dispatch('MSISDNEnabled', { alertType: 'MSISDNEnabled', iccid, msisdn, reason });

/**
 * `MSISDNDisabled` - the voice/SMS bundle expired, depleted or was revoked.
 *
 * @param {string} iccid
 * @param {string} msisdn
 * @param {'Bundle expired'|'Bundle revoked'|'Bundle depleted'} reason
 * @returns {Promise<object>}
 */
export const sendMsisdnDisabled = (iccid, msisdn, reason) =>
  dispatch('MSISDNDisabled', { alertType: 'MSISDNDisabled', iccid, msisdn, reason });

/**
 * `SMSFailed` - an SMS submitted to the eSIM could not be delivered.
 *
 * @param {string} iccid
 * @param {string} [msisdn]
 * @returns {Promise<object>}
 */
export const sendSmsFailed = (iccid, msisdn) =>
  dispatch('SMSFailed', {
    iccid,
    ...(msisdn ? { msisdn } : {}),
    alertType: 'SMSFailed',
    timestamp: clock.iso(),
  });
