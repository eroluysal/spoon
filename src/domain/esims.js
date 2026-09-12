import { config } from '../config.js';
import { state, getEsim, getCatalogueBundle, assignmentsForEsim } from '../store/state.js';
import { badRequest, forbidden, gone } from '../util/errors.js';
import { clock } from '../util/time.js';
import {
  nextIccid,
  nextMatchingId,
  nextMsisdn,
  pin,
  puk,
  lpaString,
  appleInstallUrl,
  androidInstallUrl,
} from '../util/ids.js';
import { COUNTRY_BY_ISO } from '../data/countries.js';
import {
  sendFirstAttachment,
  sendLocationUpdate,
  sendSmsFailed,
} from '../callbacks/dispatcher.js';

/**
 * eSIM lifecycle: provisioning, profile status, suspension, SMS, location and
 * the install (QR / LPA) details.
 */

/** Default branding profile id reported on eSIMs created without one. */
export const DEFAULT_BRANDING_ID = 'f616f7g8-ey0d-123d-803d-0214a2f5dafb';

/**
 * Provision a new eSIM profile.
 *
 * @param {object} [options]
 * @param {string} [options.customerRef] Partner side reference.
 * @param {string} [options.orderReference] Order that created this eSIM.
 * @param {string} [options.applyReference] Bundle apply reference, when created by /esims/apply.
 * @param {string} [options.brandingId] Branding profile id (`profileID` on the order).
 * @param {string} [options.profileName] Network profile name, e.g. `Profile 1`.
 * @param {boolean} [options.physical] True for a physical SIM rather than an eSIM.
 * @returns {object} The stored eSIM record.
 */
export function createEsim(options = {}) {
  const now = clock.now();
  const matchingId = nextMatchingId();
  const esim = {
    iccid: nextIccid(),
    customerRef: options.customerRef ?? '',
    msisdn: nextMsisdn(),
    matchingId,
    smdpAddress: config.smdpAddress,
    pin: pin(),
    puk: puk(),
    profileStatus: 'Released',
    state: 'active',
    physical: options.physical ?? false,
    assignedDate: clock.iso(now),
    lastAction: 'eSIM Assigned',
    actionDate: clock.iso(now),
    firstInstalledDateTime: undefined,
    brandingId: options.brandingId ?? DEFAULT_BRANDING_ID,
    profileName: options.profileName ?? 'Profile 1',
    orderReference: options.orderReference,
    applyReference: options.applyReference,
    suspendedBy: undefined,
    location: undefined,
    firstAttachmentAt: undefined,
    firstUseAt: undefined,
    lastActivityAt: now,
    deletionScheduledAt: undefined,
    deletedAt: undefined,
    msisdnEnabled: false,
    history: [],
    createdAt: now,
  };
  state.esims.set(esim.iccid, esim);
  return esim;
}

/**
 * Fetch an eSIM or fail the way the live API does.
 *
 * An ICCID that is not in the organisation is a 403 (never a 404), which is
 * what eSIM Go documents for cross-tenant access.
 *
 * @param {string} iccid
 * @returns {object} The eSIM record.
 * @throws {import('../util/errors.js').ApiError} 400 for a malformed ICCID, 403 when unknown.
 */
export function requireEsim(iccid) {
  const key = String(iccid ?? '').trim();
  if (!/^\d{10,22}$/.test(key)) throw badRequest('Invalid ICCID');
  const esim = getEsim(key);
  if (!esim) throw forbidden('eSIM not found or not assigned to your organisation');
  return esim;
}

/**
 * Append an entry to the eSIM history feed exposed by GET /esims/{iccid}/history.
 *
 * @param {object} esim
 * @param {string} name Event name, e.g. `Bundle Applied`.
 * @param {string} [bundleName] Bundle the event relates to.
 * @param {object} [extra] Extra fields (`alertType`, `bundleState`).
 * @returns {object} The history entry.
 */
export function recordHistory(esim, name, bundleName = '', extra = {}) {
  const entry = { name, bundleName, date: clock.isoNano(), ...extra };
  esim.history.unshift(entry);
  esim.lastAction = name;
  esim.actionDate = clock.iso();
  return entry;
}

/**
 * Mark the eSIM as active so the 180 day inactivity timer restarts.
 *
 * @param {object} esim
 * @returns {void}
 */
export function markActivity(esim) {
  esim.lastActivityAt = clock.now();
  if (esim.deletionScheduledAt) esim.deletionScheduledAt = undefined;
}

/**
 * Update the partner reference on an eSIM (PUT /esims).
 *
 * @param {string} iccid
 * @param {string} customerRef
 * @returns {object} The updated eSIM.
 */
export function updateCustomerRef(iccid, customerRef) {
  const esim = requireEsim(iccid);
  if (esim.state === 'deactivated') throw badRequest('eSIM has been deactivated');
  esim.customerRef = customerRef;
  recordHistory(esim, 'eSIM Updated');
  return esim;
}

/**
 * Deactivate an eSIM (DELETE /esims/{iccid}). The profile is released at the
 * network and the eSIM can no longer take bundles; it is not removed from the
 * organisation's history.
 *
 * @param {string} iccid
 * @returns {object} The deactivated eSIM.
 */
export function deactivateEsim(iccid) {
  const esim = requireEsim(iccid);
  if (esim.state === 'deactivated') throw badRequest('eSIM has already been deactivated');
  esim.state = 'deactivated';
  esim.profileStatus = 'Deactivated';
  esim.deletedAt = clock.now();
  esim.msisdnEnabled = false;
  recordHistory(esim, 'eSIM Deleted');
  return esim;
}

/**
 * Re-push the profile to the device (GET /esims/{iccid}/refresh).
 *
 * @param {string} iccid
 * @returns {object} The eSIM.
 */
export function refreshEsim(iccid) {
  const esim = requireEsim(iccid);
  if (esim.state === 'deactivated') throw badRequest('eSIM has been deactivated');
  recordHistory(esim, 'eSIM Refreshed');
  return esim;
}

/**
 * Suspend or unsuspend an eSIM (POST /esims/{iccid}/suspend).
 *
 * Policy driven suspensions cannot be lifted through the API, which is why an
 * unsuspend of one returns 403.
 *
 * @param {string} iccid
 * @param {boolean} suspend True to suspend, false to unsuspend.
 * @returns {{esim: object, status: string}} The eSIM and the status message.
 */
export function setSuspended(iccid, suspend) {
  const esim = requireEsim(iccid);
  if (esim.state === 'deactivated') throw badRequest('eSIM has been deactivated');

  if (suspend) {
    if (esim.state === 'suspended') throw badRequest('eSIM is already suspended');
    esim.state = 'suspended';
    esim.suspendedBy = 'partner';
    recordHistory(esim, 'eSIM Suspended');
    return { esim, status: 'eSIM suspended successfully' };
  }

  if (esim.state !== 'suspended') throw badRequest('eSIM is not suspended');
  if (esim.suspendedBy === 'policy') {
    throw forbidden('eSIM is suspended by policy enforcement and cannot be unsuspended via the API');
  }
  esim.state = 'active';
  esim.suspendedBy = undefined;
  recordHistory(esim, 'eSIM Unsuspended');
  return { esim, status: 'eSIM unsuspended successfully' };
}

/**
 * Suspend an eSIM as eSIM Go's policy engine would. Mock-only helper used by
 * the control plane to produce an unsuspendable eSIM.
 *
 * @param {string} iccid
 * @returns {object} The suspended eSIM.
 */
export function policySuspend(iccid) {
  const esim = requireEsim(iccid);
  esim.state = 'suspended';
  esim.suspendedBy = 'policy';
  recordHistory(esim, 'eSIM Suspended');
  return esim;
}

/**
 * Send an SMS to an eSIM (POST /esims/{iccid}/sms).
 *
 * @param {string} iccid
 * @param {string} message UTF-8 body, 1-160 characters.
 * @param {string} [from] Sender id shown on the device; only `eSIM` is allowed by default.
 * @returns {object} The stored SMS record.
 */
export function sendSms(iccid, message, from = 'eSIM') {
  const esim = requireEsim(iccid);
  if (esim.state === 'deactivated') throw badRequest('Cannot send SMS to a deactivated eSIM');

  const record = { iccid: esim.iccid, message, from, at: clock.iso(), status: 'sent' };

  // A suspended eSIM accepts the request but the message never lands, which is
  // exactly when the live platform emits an SMSFailed callback.
  if (esim.state === 'suspended') {
    record.status = 'failed';
    state.smsLog.push(record);
    void sendSmsFailed(esim.iccid, esim.msisdn);
    return record;
  }

  state.smsLog.push(record);
  recordHistory(esim, 'SMS Sent');
  return record;
}

/**
 * Mark the profile as downloaded and installed on a device.
 *
 * @param {string} iccid
 * @returns {object} The eSIM.
 */
export function markInstalled(iccid) {
  const esim = requireEsim(iccid);
  if (esim.state === 'deactivated') throw badRequest('eSIM has been deactivated');
  if (esim.profileStatus !== 'Installed') {
    esim.profileStatus = 'Installed';
    esim.firstInstalledDateTime = esim.firstInstalledDateTime ?? clock.now();
    recordHistory(esim, 'eSIM Installed');
  }
  return esim;
}

/**
 * Register the eSIM on a network, emitting `FirstAttachment` the first time and
 * `CountryChange` whenever the country differs from the last known location.
 *
 * @param {string} iccid
 * @param {string} [iso] Country to attach in; defaults to the first covered country.
 * @returns {object} The eSIM.
 */
export function attachToNetwork(iccid, iso) {
  const esim = requireEsim(iccid);
  if (esim.state === 'deactivated') throw badRequest('eSIM has been deactivated');

  const country = COUNTRY_BY_ISO.get(String(iso ?? '').toUpperCase()) ?? defaultCountryFor(esim);
  if (!country) throw badRequest('Unknown country ISO code');

  const operator = country.operators[0];
  const previousCountry = esim.location?.country;

  esim.location = {
    mobileNetworkCode: `${country.iso}${operator.name.slice(0, 2).toUpperCase()}${operator.mnc}`,
    networkName: operator.name,
    networkBrandName: operator.brandName,
    country: country.iso,
    lastSeen: clock.isoNano(),
  };
  if (esim.profileStatus === 'Released') esim.profileStatus = 'Installed';
  esim.firstInstalledDateTime = esim.firstInstalledDateTime ?? clock.now();
  markActivity(esim);

  if (!esim.firstAttachmentAt) {
    esim.firstAttachmentAt = clock.now();
    recordHistory(esim, 'eSIM First Attachment');
    void sendFirstAttachment(esim.iccid);
  }
  if (previousCountry !== country.iso) {
    void sendLocationUpdate(esim.iccid, country);
  }
  return esim;
}

/**
 * First country covered by any bundle currently on the eSIM, used as the
 * default attachment location.
 *
 * @param {object} esim
 * @returns {object|undefined} Country record from the reference data.
 */
function defaultCountryFor(esim) {
  for (const assignment of assignmentsForEsim(esim.iccid)) {
    const bundle = getCatalogueBundle(assignment.bundleName);
    const iso = bundle?.countries?.[0]?.iso;
    if (iso) return COUNTRY_BY_ISO.get(iso);
  }
  return COUNTRY_BY_ISO.get('GB');
}

/**
 * Last known location (GET /esims/{iccid}/location).
 *
 * @param {string} iccid
 * @returns {object|undefined} Location record, or undefined when never attached.
 */
export function locationFor(iccid) {
  return requireEsim(iccid).location;
}

/**
 * Whether a bundle can be applied to an eSIM (GET /esims/{iccid}/compatible/{bundle}).
 *
 * Compatibility is decided by the network profile: a bundle can only be applied
 * to an eSIM provisioned on the same profile, and never to a deactivated eSIM.
 *
 * @param {string} iccid
 * @param {string} bundleName
 * @returns {boolean}
 */
export function isCompatible(iccid, bundleName) {
  const esim = requireEsim(iccid);
  const bundle = getCatalogueBundle(bundleName);
  if (!bundle) return false;
  if (esim.state === 'deactivated') return false;
  return bundle.profileName === esim.profileName;
}

/**
 * Installation details for an eSIM, as returned by /esims/assignments and
 * embedded in GET /esims/{iccid}.
 *
 * @param {object} esim
 * @param {{installUrl?: boolean}} [options] Include Apple/Android deep links.
 * @returns {object} Install detail payload.
 */
export function installDetails(esim, options = {}) {
  const details = {
    iccid: esim.iccid,
    matchingId: esim.matchingId,
    smdpAddress: esim.smdpAddress,
    profileStatus: esim.profileStatus,
    pin: esim.pin,
    puk: esim.puk,
    firstInstalledDateTime: esim.firstInstalledDateTime
      ? clock.iso(esim.firstInstalledDateTime)
      : undefined,
  };
  if (options.installUrl) {
    details.appleInstallUrl = appleInstallUrl(esim.smdpAddress, esim.matchingId);
    details.androidInstallUrl = androidInstallUrl(esim.smdpAddress, esim.matchingId);
  }
  return details;
}

/**
 * The LPA activation string encoded into the eSIM's QR code.
 *
 * @param {object} esim
 * @returns {string} e.g. `LPA:1$rsp.example.com$K2-4CVQ7B-9MZXTLA`
 */
export const activationCode = (esim) => lpaString(esim.smdpAddress, esim.matchingId);

/**
 * Guard used by the install-details endpoints: a deactivated eSIM's profile is
 * gone, so the live API answers 410.
 *
 * @param {object} esim
 * @returns {object} The eSIM.
 * @throws {import('../util/errors.js').ApiError} 410 when deactivated.
 */
export function requireInstallable(esim) {
  if (esim.state === 'deactivated') throw gone('eSIM has been deactivated');
  return esim;
}

/**
 * GET /esims/{iccid} payload.
 *
 * @param {object} esim
 * @param {{installUrl?: boolean}} [options]
 * @returns {object} eSIM details in wire format.
 */
export function esimDetails(esim, options = {}) {
  return {
    iccid: esim.iccid,
    msisdn: esim.msisdnEnabled ? esim.msisdn : '',
    pin: esim.pin,
    puk: esim.puk,
    matchingId: esim.matchingId,
    smdpAddress: esim.smdpAddress,
    profileStatus: esim.profileStatus,
    firstInstalledDateTime: esim.firstInstalledDateTime ?? 0,
    customerRef: esim.customerRef,
    ...(options.installUrl
      ? {
          appleInstallUrl: appleInstallUrl(esim.smdpAddress, esim.matchingId),
          androidInstallUrl: androidInstallUrl(esim.smdpAddress, esim.matchingId),
        }
      : {}),
    brandingId: esim.brandingId,
    profileName: esim.profileName,
    state: esim.state,
  };
}

/**
 * GET /esims list row.
 *
 * @param {object} esim
 * @returns {object} Summary row in wire format.
 */
export const esimSummary = (esim) => ({
  iccid: esim.iccid,
  customerRef: esim.customerRef,
  msisdn: esim.msisdnEnabled ? esim.msisdn : '',
  lastAction: esim.lastAction,
  actionDate: esim.actionDate,
  physical: esim.physical,
  assignedDate: esim.assignedDate,
  state: esim.state,
});
