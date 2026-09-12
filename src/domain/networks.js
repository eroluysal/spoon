import { COUNTRIES, COUNTRY_BY_ISO, COUNTRY_BY_NAME } from '../data/countries.js';

/**
 * Network reference data (GET /networks) and the per-country network blocks
 * embedded in v2.5 catalogue responses.
 */

/** ISO 3166-1 alpha-3 codes, used to build TADIG identifiers. */
const ISO3 = {
  GB: 'GBR', IE: 'IRL', DE: 'DEU', FR: 'FRA', IT: 'ITA', ES: 'ESP', PT: 'PRT', NL: 'NLD',
  BE: 'BEL', LU: 'LUX', AT: 'AUT', CH: 'CHE', SE: 'SWE', NO: 'NOR', DK: 'DNK', FI: 'FIN',
  IS: 'ISL', PL: 'POL', CZ: 'CZE', SK: 'SVK', HU: 'HUN', SI: 'SVN', HR: 'HRV', GR: 'GRC',
  RO: 'ROU', BG: 'BGR', EE: 'EST', LV: 'LVA', LT: 'LTU', CY: 'CYP', MT: 'MLT', TR: 'TUR',
  UA: 'UKR', US: 'USA', CA: 'CAN', MX: 'MEX', BR: 'BRA', AR: 'ARG', CL: 'CHL', CO: 'COL',
  PE: 'PER', JP: 'JPN', KR: 'KOR', CN: 'CHN', HK: 'HKG', TW: 'TWN', SG: 'SGP', MY: 'MYS',
  TH: 'THA', VN: 'VNM', ID: 'IDN', PH: 'PHL', IN: 'IND', LK: 'LKA', PK: 'PAK', BD: 'BGD',
  NP: 'NPL', KZ: 'KAZ', GE: 'GEO', AM: 'ARM', AZ: 'AZE', AE: 'ARE', SA: 'SAU', QA: 'QAT',
  KW: 'KWT', BH: 'BHR', OM: 'OMN', IL: 'ISR', JO: 'JOR', ZA: 'ZAF', EG: 'EGY', MA: 'MAR',
  TN: 'TUN', KE: 'KEN', NG: 'NGA', GH: 'GHA', TZ: 'TZA', AU: 'AUS', NZ: 'NZL', FJ: 'FJI',
};

/**
 * TADIG code for an operator, e.g. `GBREE` for EE in the United Kingdom.
 *
 * @param {{iso: string}} country
 * @param {{name: string}} operator
 * @returns {string} Five character TADIG code.
 */
export function tadigFor(country, operator) {
  const prefix = ISO3[country.iso] ?? country.iso.padEnd(3, 'X');
  const letters = operator.name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return `${prefix}${(letters.slice(0, 2) || 'X1').padEnd(2, '1')}`;
}

/**
 * One network row in the GET /networks response.
 *
 * @param {object} country Country reference record.
 * @param {object} operator Operator reference record.
 * @returns {{name: string, brandName: string, mcc: string, mnc: string, tagid: string, speed: string[]}}
 */
export const networkRow = (country, operator) => ({
  name: operator.name,
  brandName: operator.brandName,
  mcc: country.mcc,
  mnc: operator.mnc,
  tagid: tadigFor(country, operator),
  speed: operator.speed,
});

/**
 * Resolve the `countries` / `isos` query parameters to country records.
 *
 * @param {object} query
 * @param {string} [query.countries] Comma separated country names.
 * @param {string} [query.isos] Comma separated ISO2 codes.
 * @param {string|boolean} [query.returnAll] Return every country when truthy.
 * @returns {object[]} Matching country records.
 */
export function resolveCountries(query = {}) {
  const returnAll = ['true', '1', 'yes', true].includes(
    typeof query.returnAll === 'string' ? query.returnAll.toLowerCase() : query.returnAll,
  );
  if (returnAll) return COUNTRIES;

  const wanted = [];
  for (const name of String(query.countries ?? '').split(',')) {
    const country = COUNTRY_BY_NAME.get(name.trim().toLowerCase());
    if (country) wanted.push(country);
  }
  for (const iso of String(query.isos ?? '').split(',')) {
    const country = COUNTRY_BY_ISO.get(iso.trim().toUpperCase());
    if (country && !wanted.includes(country)) wanted.push(country);
  }
  return wanted.length > 0 ? wanted : COUNTRIES;
}

/**
 * GET /networks payload.
 *
 * @param {object} [query] Raw query string parameters.
 * @returns {{countryNetworks: {name: string, networks: object[]}[]}}
 */
export function networksPayload(query = {}) {
  return {
    countryNetworks: resolveCountries(query).map((country) => ({
      name: country.name,
      networks: country.operators.map((operator) => networkRow(country, operator)),
    })),
  };
}

/**
 * The `countryNetworks` block v2.5 adds to catalogue bundles: for every covered
 * country, the networks reachable with the bundle.
 *
 * @param {{iso: string}[]} coverage Bundle coverage (`{name, region, iso}` triples).
 * @returns {object[]} Country network blocks.
 */
export function coverageNetworks(coverage) {
  return coverage
    .map((entry) => {
      const country = COUNTRY_BY_ISO.get(entry.iso);
      if (!country) return undefined;
      return {
        country: { name: country.name, region: country.region, iso: country.iso },
        networks: country.operators.map((operator) => ({
          name: operator.name,
          brandName: operator.brandName,
          tadig: tadigFor(country, operator),
          mccMnc: [`${country.mcc}-${operator.mnc}`],
          speeds: operator.speed,
        })),
        potentialNetworks: [],
      };
    })
    .filter(Boolean);
}
