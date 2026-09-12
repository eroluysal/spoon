import { COUNTRIES, REGIONS, REGION_CODES, asCoverage, countriesInRegion } from './countries.js';

/**
 * Deterministic catalogue generator.
 *
 * The live eSIM Go catalogue holds a few thousand bundles built from a small
 * number of templates (size x duration x coverage). We generate the same shape
 * so pagination, filtering and ordering can be exercised for real, and we do it
 * deterministically so bundle names and prices survive a restart.
 */

/** Fixed-data bundle sizes in GB. */
const FIXED_SIZES_GB = [1, 3, 5, 10, 20];

/** Validity windows in days offered for fixed-data bundles. */
const FIXED_DURATIONS = [7, 15, 30];

/** Validity windows in days offered for unlimited bundles. */
const UNLIMITED_DURATIONS = [1, 3, 5, 7, 10, 15, 30];

/** Countries that also get a Voice + SMS variant. */
const VOICE_SMS_ISOS = ['GB', 'US', 'DE', 'FR', 'TR', 'AE', 'ES', 'IT'];

/** Fair-use ceiling reported on unlimited bundles (MB). */
const UNLIMITED_FAIR_USE_MB = 50000;

/** Per-region wholesale price multipliers. */
const REGION_FACTOR = {
  Europe: 1.0,
  'North America': 1.15,
  'South America': 1.35,
  Asia: 1.1,
  'Middle East': 1.3,
  Africa: 1.5,
  Oceania: 1.25,
};

export const BUNDLE_GROUPS = [
  {
    name: 'Standard Fixed Bundles',
    desc: 'Single country, fixed data allowance bundles',
    priceListUrl: 'https://portal.esim-go.com/pricing/standard-fixed.csv',
    icon: 'https://portal.esim-go.com/icons/standard-fixed.svg',
  },
  {
    name: 'Standard Unlimited Bundles',
    desc: 'Single country, unlimited data bundles with fair use policy',
    priceListUrl: 'https://portal.esim-go.com/pricing/standard-unlimited.csv',
    icon: 'https://portal.esim-go.com/icons/standard-unlimited.svg',
  },
  {
    name: 'Regional Bundles',
    desc: 'Multi country bundles covering a whole region',
    priceListUrl: 'https://portal.esim-go.com/pricing/regional.csv',
    icon: 'https://portal.esim-go.com/icons/regional.svg',
  },
  {
    name: 'Global Bundles',
    desc: 'Worldwide coverage bundles',
    priceListUrl: 'https://portal.esim-go.com/pricing/global.csv',
    icon: 'https://portal.esim-go.com/icons/global.svg',
  },
  {
    name: 'Voice & SMS Bundles',
    desc: 'Data bundles that also carry voice minutes and SMS, MSISDN enabled',
    priceListUrl: 'https://portal.esim-go.com/pricing/voice-sms.csv',
    icon: 'https://portal.esim-go.com/icons/voice-sms.svg',
  },
];

/**
 * Round to 2 decimals, avoiding float noise like 9.860000000000001.
 *
 * @param {number} value
 * @returns {number}
 */
const money = (value) => Math.round(value * 100) / 100;

/**
 * Pick one of the five eSIM Go network profiles deterministically from a key.
 *
 * @param {string} key Bundle name or coverage code.
 * @returns {string} e.g. `Profile 2`
 */
function profileFor(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 997;
  return `Profile ${(hash % 5) + 1}`;
}

/**
 * Wholesale price for a fixed-data bundle.
 *
 * @param {number} gb Data allowance in GB.
 * @param {number} days Validity in days.
 * @param {number} factor Coverage price multiplier.
 * @returns {number}
 */
const fixedPrice = (gb, days, factor) => money((0.9 + 1.1 * gb ** 0.85 + 0.04 * days) * factor);

/**
 * Wholesale price for an unlimited bundle.
 *
 * @param {number} days Validity in days.
 * @param {number} factor Coverage price multiplier.
 * @returns {number}
 */
const unlimitedPrice = (days, factor) => money((3.2 + 1.05 * days ** 0.9) * factor);

/**
 * Human readable data label used inside bundle names and descriptions.
 *
 * @param {number} gb
 * @returns {string} e.g. `5GB`
 */
const sizeLabel = (gb) => `${gb}GB`;

/**
 * Build the DATA allowance row for a bundle.
 *
 * @param {number} amountMb Allowance in megabytes.
 * @param {boolean} unlimited
 * @returns {{type: string, service: string, description: string, amount: number, unit: string, unlimited: boolean}}
 */
const dataAllowance = (amountMb, unlimited) => ({
  type: 'DATA',
  service: 'STANDARD',
  description: unlimited ? 'Unlimited data, fair use policy applies' : `${amountMb} MB of data`,
  amount: amountMb,
  unit: 'MB',
  unlimited,
});

/**
 * Assemble a single catalogue bundle record.
 *
 * @param {object} spec
 * @param {string} spec.name Bundle name, e.g. `esim_5GB_30D_GB_V2`.
 * @param {string} spec.description Human readable description.
 * @param {string[]} spec.groups Bundle groups this bundle belongs to.
 * @param {{name: string, region: string, iso: string}[]} spec.countries Base coverage.
 * @param {number} spec.dataAmount Data allowance in MB.
 * @param {number} spec.duration Validity in days.
 * @param {string[]} spec.speed Supported radio technologies.
 * @param {boolean} spec.unlimited Whether data is unlimited.
 * @param {boolean} spec.autostart Whether the bundle starts on assignment.
 * @param {number} spec.price Wholesale price.
 * @param {object[]} [spec.extraAllowances] Voice / SMS allowances, if any.
 * @returns {object} Catalogue bundle in eSIM Go wire format.
 */
function makeBundle(spec) {
  return {
    name: spec.name,
    description: spec.description,
    groups: spec.groups,
    countries: spec.countries,
    dataAmount: spec.dataAmount,
    duration: spec.duration,
    speed: spec.speed,
    autostart: spec.autostart,
    unlimited: spec.unlimited,
    roamingEnabled: spec.countries,
    price: spec.price,
    billingType: 'FixedCost',
    profileName: profileFor(spec.name),
    allowances: [dataAllowance(spec.dataAmount, spec.unlimited), ...(spec.extraAllowances ?? [])],
  };
}

/**
 * Union of the radio technologies offered by a coverage set.
 *
 * @param {{operators: {speed: string[]}[]}[]} countries
 * @returns {string[]} Ordered 3G/4G/5G subset.
 */
function speedsFor(countries) {
  const set = new Set();
  for (const country of countries) for (const op of country.operators) for (const s of op.speed) set.add(s);
  return ['3G', '4G', '5G'].filter((s) => set.has(s));
}

/**
 * Generate every bundle for one coverage area (a country, a region or global).
 *
 * @param {object} area
 * @param {string} area.code Coverage code used in the bundle name (ISO2, region code or `IM`).
 * @param {string} area.label Human readable coverage name.
 * @param {object[]} area.countries Source country records.
 * @param {number} area.factor Price multiplier.
 * @param {string} area.fixedGroup Group for fixed bundles.
 * @param {string} area.unlimitedGroup Group for unlimited bundles.
 * @param {boolean} [area.voiceSms] Also emit a Voice + SMS variant.
 * @returns {object[]} Catalogue bundles.
 */
function bundlesForArea(area) {
  const coverage = area.countries.map(asCoverage);
  const speed = speedsFor(area.countries);
  const bundles = [];

  for (const gb of FIXED_SIZES_GB) {
    for (const days of FIXED_DURATIONS) {
      const name = `esim_${sizeLabel(gb)}_${days}D_${area.code}_V2`;
      bundles.push(
        makeBundle({
          name,
          description: `eSIM, ${sizeLabel(gb)}, ${days} Days, ${area.label}, V2`,
          groups: [area.fixedGroup],
          countries: coverage,
          dataAmount: gb * 1000,
          duration: days,
          speed,
          unlimited: false,
          autostart: days === 1,
          price: fixedPrice(gb, days, area.factor),
        }),
      );
    }
  }

  for (const days of UNLIMITED_DURATIONS) {
    const name = `esim_ULTD_${days}D_${area.code}_U`;
    bundles.push(
      makeBundle({
        name,
        description: `eSIM, Unlimited, ${days} Days, ${area.label}, Unthrottled`,
        groups: [area.unlimitedGroup],
        countries: coverage,
        dataAmount: UNLIMITED_FAIR_USE_MB,
        duration: days,
        speed,
        unlimited: true,
        autostart: true,
        price: unlimitedPrice(days, area.factor),
      }),
    );
  }

  if (area.voiceSms) {
    for (const gb of [5, 10]) {
      const days = 30;
      const name = `esim_${sizeLabel(gb)}_${days}D_${area.code}_VS`;
      bundles.push(
        makeBundle({
          name,
          description: `eSIM, ${sizeLabel(gb)} + Voice + SMS, ${days} Days, ${area.label}`,
          groups: ['Voice & SMS Bundles'],
          countries: coverage,
          dataAmount: gb * 1000,
          duration: days,
          speed,
          unlimited: false,
          autostart: false,
          price: money(fixedPrice(gb, days, area.factor) + 4.5),
          extraAllowances: [
            {
              type: 'VOICE',
              service: 'STANDARD',
              description: '100 minutes of outbound voice',
              amount: 100,
              unit: 'MINS',
              unlimited: false,
            },
            {
              type: 'SMS',
              service: 'STANDARD',
              description: '100 outbound SMS',
              amount: 100,
              unit: 'SMS',
              unlimited: false,
            },
          ],
        }),
      );
    }
  }

  return bundles;
}

/**
 * Build the whole catalogue: per country, per region and global bundles.
 *
 * @param {{countryLimit?: number}} [options] `countryLimit` caps single country coverage (0 = all).
 * @returns {object[]} Every catalogue bundle, ordered by name.
 */
export function buildCatalogue(options = {}) {
  const limit = options.countryLimit && options.countryLimit > 0 ? options.countryLimit : COUNTRIES.length;
  const countries = COUNTRIES.slice(0, limit);
  const bundles = [];

  for (const country of countries) {
    bundles.push(
      ...bundlesForArea({
        code: country.iso,
        label: country.name,
        countries: [country],
        factor: REGION_FACTOR[country.region] ?? 1,
        fixedGroup: 'Standard Fixed Bundles',
        unlimitedGroup: 'Standard Unlimited Bundles',
        voiceSms: VOICE_SMS_ISOS.includes(country.iso),
      }),
    );
  }

  for (const region of REGIONS) {
    const regionCountries = countriesInRegion(region).filter((c) => countries.includes(c));
    if (regionCountries.length < 2) continue;
    bundles.push(
      ...bundlesForArea({
        code: REGION_CODES[region],
        label: region,
        countries: regionCountries,
        factor: (REGION_FACTOR[region] ?? 1) * 1.6,
        fixedGroup: 'Regional Bundles',
        unlimitedGroup: 'Regional Bundles',
      }),
    );
  }

  bundles.push(
    ...bundlesForArea({
      code: 'IM',
      label: 'Global',
      countries,
      factor: 2.2,
      fixedGroup: 'Global Bundles',
      unlimitedGroup: 'Global Bundles',
    }),
  );

  return bundles.sort((a, b) => a.name.localeCompare(b.name));
}
