import { createHash } from 'node:crypto';
import { state, getCatalogueBundle } from '../store/state.js';
import { badRequest } from '../util/errors.js';
import { parsePage, paginate } from '../util/paging.js';
import { COUNTRIES } from '../data/countries.js';
import { coverageNetworks } from './networks.js';

/**
 * Catalogue browsing: filtering, ordering, pagination, bundle detail and the
 * consumption price list.
 */

/** Columns GET /catalogue can be ordered by. */
const ORDERABLE = new Set(['name', 'description', 'price', 'dataAmount', 'duration']);

/**
 * Apply the documented query filters to the catalogue.
 *
 * @param {object} query Raw query string parameters.
 * @param {string} [query.description] Wildcard (substring) match on the description.
 * @param {string} [query.group] Exact bundle group match.
 * @param {string} [query.countries] Comma separated ISO2 list; matches base coverage.
 * @param {string} [query.region] Region name, e.g. `Europe`.
 * @returns {object[]} Matching bundles.
 */
export function filterCatalogue(query = {}) {
  let bundles = state.catalogue;

  if (query.description) {
    const needle = String(query.description).toLowerCase();
    bundles = bundles.filter((bundle) => bundle.description.toLowerCase().includes(needle));
  }
  if (query.group) {
    const group = String(query.group);
    bundles = bundles.filter((bundle) => bundle.groups.includes(group));
  }
  if (query.countries) {
    const isos = String(query.countries)
      .split(',')
      .map((iso) => iso.trim().toUpperCase())
      .filter(Boolean);
    bundles = bundles.filter((bundle) => bundle.countries.some((c) => isos.includes(c.iso)));
  }
  if (query.region) {
    const region = String(query.region).toLowerCase();
    bundles = bundles.filter((bundle) => bundle.countries.some((c) => c.region.toLowerCase() === region));
  }
  return bundles;
}

/**
 * GET /catalogue: filter, order and paginate.
 *
 * @param {object} query Raw query string parameters.
 * @returns {object[]} Page of catalogue bundles in wire format.
 */
export function cataloguePage(query = {}) {
  const { page, perPage } = parsePage(query.page, query.perPage, { defaultPerPage: 50, maxPerPage: 500 });

  const orderBy = query.orderBy ? String(query.orderBy) : 'name';
  if (!ORDERABLE.has(orderBy)) {
    throw badRequest(`Invalid value for orderBy: must be one of ${[...ORDERABLE].join(', ')}`);
  }
  const direction = String(query.direction ?? 'asc').toLowerCase();
  if (!['asc', 'desc'].includes(direction)) {
    throw badRequest('Invalid value for direction: must be one of asc, desc');
  }

  const filtered = [...filterCatalogue(query)].sort((a, b) => {
    const av = a[orderBy];
    const bv = b[orderBy];
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return direction === 'desc' ? -cmp : cmp;
  });

  return paginate(filtered, { page, perPage }).map(bundlePayload);
}

/**
 * Wire format for a catalogue bundle, including the v2.5 `countryNetworks` block.
 *
 * @param {object} bundle Stored catalogue bundle.
 * @returns {object} Catalogue bundle payload.
 */
export function bundlePayload(bundle) {
  return {
    name: bundle.name,
    description: bundle.description,
    groups: bundle.groups,
    countries: bundle.countries,
    countryNetworks: coverageNetworks(bundle.countries),
    dataAmount: bundle.dataAmount,
    duration: bundle.duration,
    speed: bundle.speed,
    autostart: bundle.autostart,
    unlimited: bundle.unlimited,
    roamingEnabled: bundle.roamingEnabled,
    price: bundle.price,
    billingType: bundle.billingType,
    profileName: bundle.profileName,
    allowances: bundle.allowances,
  };
}

/**
 * GET /catalogue/bundle/{name}: one bundle, with its groups under `group`.
 *
 * @param {string} name Bundle name (case sensitive).
 * @returns {object} Bundle detail payload.
 * @throws {import('../util/errors.js').ApiError} 400 when unknown.
 */
export function bundleDetail(name) {
  const bundle = getCatalogueBundle(name);
  if (!bundle) throw badRequest(`Bundle ${name} does not exist`);
  const { groups, ...rest } = bundlePayload(bundle);
  return { ...rest, group: groups };
}

/**
 * Deterministic consumption price for a country and network profile.
 *
 * @param {{iso: string, region: string}} country
 * @param {number} profileIndex 1-5.
 * @returns {string} Price with two decimals, as the live API returns it (string).
 */
function consumptionPrice(country, profileIndex) {
  let hash = 0;
  for (const char of `${country.iso}${profileIndex}`) hash = (hash * 33 + char.charCodeAt(0)) % 5000;
  const base = 0.85 + (hash % 400) / 100 + profileIndex * 0.15;
  return (Math.round(base * 100) / 100).toFixed(2);
}

/**
 * GET /catalogue/prices: per-country consumption rates for every profile.
 *
 * @returns {{hash: string, prices: object[]}} Price list with a content hash.
 */
export function cataloguePrices() {
  const currency = state.organisation.currency;
  const prices = COUNTRIES.map((country) => {
    const countryRef = { iso: country.iso, name: country.name };
    return {
      country: countryRef,
      prices: [1, 2, 3, 4, 5].map((profileIndex) => ({
        id: profileUuid(country.iso, profileIndex),
        price: consumptionPrice(country, profileIndex),
        currency,
        profile: `Profile ${profileIndex}`,
        country: countryRef,
      })),
    };
  });

  const hash = createHash('sha256').update(JSON.stringify(prices)).digest('hex').slice(0, 32);
  return { hash, prices };
}

/**
 * Stable UUID-shaped id for a country/profile price row.
 *
 * @param {string} iso
 * @param {number} profileIndex
 * @returns {string} UUID v4 shaped identifier.
 */
function profileUuid(iso, profileIndex) {
  const digest = createHash('sha1').update(`${iso}-${profileIndex}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(13, 16)}`,
    `8${digest.slice(17, 20)}`,
    digest.slice(20, 32),
  ].join('-');
}
