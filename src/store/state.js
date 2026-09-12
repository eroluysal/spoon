import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { config } from '../config.js';
import { buildCatalogue, BUNDLE_GROUPS } from '../data/catalogue.js';
import { clock, dateOnly, addDays } from '../util/time.js';
import { resetSequences } from '../util/ids.js';

/**
 * The whole mock lives in this module: a single in-process store holding the
 * organisation, its eSIMs, bundle assignments, inventory, orders and the
 * callback/SMS logs. Everything is plain Maps so tests can poke at it directly.
 */

/** @typedef {import('../data/catalogue.js')} Catalogue */

/**
 * Build the default organisation record from configuration.
 *
 * @returns {object} Organisation in eSIM Go wire format plus a few mock-only fields.
 */
function defaultOrganisation() {
  return {
    name: config.organisation.name,
    apiKey: config.apiKeys[0],
    taxLiable: 'Yes',
    addr1: '1 Mock Street',
    addr2: 'Floor 3',
    city: 'London',
    country: 'United Kingdom',
    postcode: 'EC1A 1BB',
    callbackUrl: config.organisation.callbackUrl,
    callbackVersion: config.organisation.callbackVersion,
    notes: 'Sandbox organisation served by the Spoon mock',
    groups: BUNDLE_GROUPS.map((g) => g.name),
    currency: config.organisation.currency,
    balance: config.organisation.balance,
    testCredit: config.organisation.testCredit,
    testCreditExpiry: dateOnly(addDays(clock.now(), 90)),
    businessType: 'Corporation',
    website: 'https://example.com',
    productDescription: 'Travel eSIM reseller (mock)',
    lowBalanceThreshold: config.organisation.lowBalanceThreshold,
    users: [
      {
        firstName: 'Ada',
        lastName: 'Mockworth',
        role: 'Admin',
        emailAddress: 'ada@example.com',
        phoneNumber: '+44 20 7946 0958',
        timeZone: 'Europe/London',
      },
      {
        firstName: 'Sam',
        lastName: 'Testerson',
        role: 'Developer',
        emailAddress: 'sam@example.com',
        phoneNumber: '+44 20 7946 0102',
        timeZone: 'Europe/London',
      },
    ],
  };
}

/**
 * Create an empty state object with a freshly generated catalogue.
 *
 * @returns {object} The mock's root state.
 */
function createState() {
  const catalogue = buildCatalogue({ countryLimit: config.catalogue.countryLimit });
  return {
    organisation: defaultOrganisation(),
    catalogue,
    catalogueByName: new Map(catalogue.map((b) => [b.name, b])),
    groups: BUNDLE_GROUPS,
    /** @type {Map<string, object>} ICCID -> eSIM */
    esims: new Map(),
    /** @type {Map<string, object>} assignment id -> bundle assignment */
    assignments: new Map(),
    /** @type {Map<number, object>} usageId -> inventory row */
    inventory: new Map(),
    /** @type {Map<string, object>} orderReference -> order */
    orders: new Map(),
    /** @type {Map<string, object>} apply/order reference -> reference record */
    references: new Map(),
    /** @type {object[]} Outbound callback attempts, newest last. */
    callbackLog: [],
    /** @type {object[]} SMS submitted through POST /esims/{iccid}/sms */
    smsLog: [],
    /** @type {object[]} Balance top-ups. */
    topups: [],
    /** @type {object[]} Injected failure rules from the /__mock control plane. */
    failures: [],
    startedAt: clock.iso(),
  };
}

export let state = createState();

/**
 * Replace the entire state with a fresh one. Sequences and the virtual clock
 * are reset too, so a reset run reproduces identical identifiers.
 *
 * @param {{keepClock?: boolean}} [options]
 * @returns {object} The new state.
 */
export function resetState(options = {}) {
  if (!options.keepClock) clock.reset();
  resetSequences();
  state = createState();
  return state;
}

/**
 * Look up an eSIM by ICCID.
 *
 * @param {string} iccid
 * @returns {object|undefined}
 */
export const getEsim = (iccid) => state.esims.get(String(iccid));

/**
 * Every eSIM, ordered by assignment date (newest first).
 *
 * @returns {object[]}
 */
export const listEsims = () =>
  [...state.esims.values()].sort((a, b) => b.createdAt - a.createdAt);

/**
 * All bundle assignments belonging to one eSIM, newest first.
 *
 * @param {string} iccid
 * @returns {object[]}
 */
export const assignmentsForEsim = (iccid) =>
  [...state.assignments.values()]
    .filter((a) => a.iccid === String(iccid))
    .sort((a, b) => b.createdAt - a.createdAt);

/**
 * Catalogue lookup. Bundle names are case sensitive in the live API.
 *
 * @param {string} name
 * @returns {object|undefined}
 */
export const getCatalogueBundle = (name) => state.catalogueByName.get(name);

/**
 * Inventory rows that still have stock and have not expired, oldest expiry first.
 *
 * @param {string} [bundleName] Restrict to a single bundle.
 * @returns {object[]}
 */
export function availableInventory(bundleName) {
  const now = clock.now();
  return [...state.inventory.values()]
    .filter((item) => item.remaining > 0 && Date.parse(item.expiry) > now)
    .filter((item) => (bundleName ? item.bundleName === bundleName : true))
    .sort((a, b) => Date.parse(a.expiry) - Date.parse(b.expiry));
}

/**
 * Serialise the state to a JSON-safe structure (Maps become arrays).
 *
 * @returns {object}
 */
export function snapshot() {
  return {
    organisation: state.organisation,
    esims: [...state.esims.values()],
    assignments: [...state.assignments.values()],
    inventory: [...state.inventory.values()],
    orders: [...state.orders.values()],
    references: [...state.references.values()],
    callbackLog: state.callbackLog,
    smsLog: state.smsLog,
    topups: state.topups,
    failures: state.failures,
    clockOffsetMs: clock.offset,
    startedAt: state.startedAt,
  };
}

/**
 * Restore a snapshot produced by {@link snapshot}. The catalogue is always
 * regenerated rather than restored, since it is derived data.
 *
 * @param {object} data
 * @returns {object} The rehydrated state.
 */
export function hydrate(data) {
  state.organisation = { ...state.organisation, ...(data.organisation ?? {}) };
  state.esims = new Map((data.esims ?? []).map((e) => [e.iccid, e]));
  state.assignments = new Map((data.assignments ?? []).map((a) => [a.id, a]));
  state.inventory = new Map((data.inventory ?? []).map((i) => [i.usageId, i]));
  state.orders = new Map((data.orders ?? []).map((o) => [o.orderReference, o]));
  state.references = new Map((data.references ?? []).map((r) => [r.reference, r]));
  state.callbackLog = data.callbackLog ?? [];
  state.smsLog = data.smsLog ?? [];
  state.topups = data.topups ?? [];
  state.failures = data.failures ?? [];
  state.startedAt = data.startedAt ?? state.startedAt;
  if (typeof data.clockOffsetMs === 'number') {
    clock.reset();
    clock.advanceMs(data.clockOffsetMs);
  }
  return state;
}

/**
 * Write the state to `config.statePath`, if persistence is enabled.
 *
 * @returns {boolean} True when a file was written.
 */
export function persist() {
  if (!config.statePath) return false;
  writeFileSync(config.statePath, JSON.stringify(snapshot(), null, 2));
  return true;
}

/**
 * Load state from `config.statePath` when the file exists.
 *
 * @returns {boolean} True when state was restored.
 */
export function restore() {
  if (!config.statePath || !existsSync(config.statePath)) return false;
  hydrate(JSON.parse(readFileSync(config.statePath, 'utf8')));
  return true;
}
