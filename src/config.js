/**
 * Runtime configuration. Every knob is settable through the environment so the
 * mock can be dropped into docker-compose / CI without touching code.
 */

/**
 * Read an integer environment variable.
 *
 * @param {string} name Variable name.
 * @param {number} fallback Value used when unset or unparseable.
 * @returns {number}
 */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read a decimal environment variable.
 *
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Read a boolean environment variable (`1`, `true`, `yes`, `on`).
 *
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/**
 * Read a string environment variable.
 *
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function str(name, fallback) {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? fallback : raw;
}

/**
 * Read a comma separated list environment variable.
 *
 * @param {string} name
 * @param {string[]} fallback
 * @returns {string[]}
 */
function list(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

export const config = {
  host: str('HOST', '0.0.0.0'),
  /** 3000 is deliberately avoided: it is left free for a Rails app. */
  port: int('PORT', 4010),

  /** Mounted under this prefix, exactly like https://api.esim-go.com/v2.5 */
  basePath: str('BASE_PATH', '/v2.5'),

  /** Accepted X-API-Key values. The first one is reported as the organisation key. */
  apiKeys: list('API_KEYS', ['esimgo-mock-key']),

  /** IP whitelist. Empty = every source IP is allowed. */
  ipWhitelist: list('IP_WHITELIST', []),

  rateLimit: {
    enabled: bool('RATE_LIMIT_ENABLED', true),
    /** eSIM Go documents 10 requests/second per IP, fixed window. */
    limit: int('RATE_LIMIT', 10),
    windowMs: int('RATE_LIMIT_WINDOW_MS', 1000),
  },

  /** Simulated SM-DP+ host used to build matching IDs and LPA strings. */
  smdpAddress: str('SMDP_ADDRESS', 'rsp.esim-go-mock.local'),

  organisation: {
    name: str('ORG_NAME', 'Spoon Mock Travel Co'),
    currency: str('ORG_CURRENCY', 'USD'),
    balance: num('ORG_BALANCE', 10000),
    testCredit: num('ORG_TEST_CREDIT', 500),
    lowBalanceThreshold: num('ORG_LOW_BALANCE_THRESHOLD', 2600),
    callbackUrl: str('CALLBACK_URL', ''),
    /** 'V2' | 'V3' - V3 signs the raw body with HMAC-SHA256. */
    callbackVersion: str('CALLBACK_VERSION', 'V3'),
  },

  simulation: {
    /** Background engine tick. Drives usage, expiry and lifecycle events. */
    tickMs: int('SIM_TICK_MS', 2000),
    /** Auto-consume data on installed eSIMs that have an active bundle. */
    autoUsage: bool('SIM_AUTO_USAGE', true),
    /** Bytes per second consumed per active data assignment when autoUsage is on. */
    bytesPerSecond: int('SIM_BYTES_PER_SECOND', 250000),
    /** Auto install + attach an eSIM this many ms after assignment (0 = off). */
    autoInstallAfterMs: int('SIM_AUTO_INSTALL_AFTER_MS', 10000),
    /** How long a freshly applied bundle stays in `processing`. */
    processingMs: int('SIM_PROCESSING_MS', 3000),
    /** Inactivity window before an eSIM is scheduled for deletion (180 days). */
    inactivityDays: int('SIM_INACTIVITY_DAYS', 180),
    /** Grace period between `esim.deletion_scheduled` and `esim.deleted`. */
    deletionGraceDays: int('SIM_DELETION_GRACE_DAYS', 7),
    /** Days an unused bundle sits in inventory before it can no longer be applied. */
    inventoryExpiryDays: int('SIM_INVENTORY_EXPIRY_DAYS', 365),
  },

  catalogue: {
    /** Number of ISO countries to generate single country bundles for (0 = all). */
    countryLimit: int('CATALOGUE_COUNTRY_LIMIT', 0),
  },

  /** Seeded demo data created on boot. */
  seed: {
    esims: int('SEED_ESIMS', 3),
    inventory: bool('SEED_INVENTORY', true),
  },

  /** Persist state to this JSON file (empty = pure in-memory). */
  statePath: str('STATE_PATH', ''),

  logLevel: str('LOG_LEVEL', 'info'),
};
