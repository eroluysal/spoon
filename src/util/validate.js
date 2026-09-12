import { badRequest } from './errors.js';

/**
 * Require a plain JSON object.
 *
 * @param {unknown} body Value to check.
 * @param {string} [what] Name used in the error message.
 * @returns {object} The value, narrowed to an object.
 * @throws {import('./errors.js').ApiError} 400 when not an object.
 */
export function requireObject(body, what = 'request body') {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest(`Invalid ${what}: expected a JSON object`);
  }
  return body;
}

/**
 * Require a non-empty string.
 *
 * @param {unknown} value
 * @param {string} field Field name used in the error message.
 * @param {{min?: number, max?: number}} [bounds] Length bounds.
 * @returns {string}
 * @throws {import('./errors.js').ApiError} 400 when missing or out of bounds.
 */
export function requireString(value, field, { min = 1, max = Infinity } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`Missing or invalid required field: ${field}`);
  }
  if (value.length < min) throw badRequest(`${field} must be at least ${min} characters`);
  if (value.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return value;
}

/**
 * Accept a string or nothing at all.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {{max?: number}} [bounds]
 * @returns {string|undefined}
 */
export function optionalString(value, field, { max = Infinity } = {}) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`Invalid value for ${field}: expected a string`);
  if (value.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return value;
}

/**
 * Require an integer, accepting numeric strings from the query string.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {{min?: number, max?: number}} [bounds]
 * @returns {number}
 * @throws {import('./errors.js').ApiError} 400 when missing or out of range.
 */
export function requireInt(value, field, { min = -Infinity, max = Infinity } = {}) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(parsed)) throw badRequest(`Missing or invalid required field: ${field}`);
  if (parsed < min) throw badRequest(`${field} must be at least ${min}`);
  if (parsed > max) throw badRequest(`${field} must be at most ${max}`);
  return parsed;
}

/**
 * Accept an integer or nothing at all.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {{min?: number, max?: number}} [opts]
 * @returns {number|undefined}
 */
export function optionalInt(value, field, opts = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  return requireInt(value, field, opts);
}

/**
 * Require a finite number, accepting numeric strings.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {{min?: number, max?: number}} [bounds]
 * @returns {number}
 * @throws {import('./errors.js').ApiError} 400 when missing or out of range.
 */
export function requireNumber(value, field, { min = -Infinity, max = Infinity } = {}) {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw badRequest(`Missing or invalid required field: ${field}`);
  }
  if (parsed < min) throw badRequest(`${field} must be at least ${min}`);
  if (parsed > max) throw badRequest(`${field} must be at most ${max}`);
  return parsed;
}

/**
 * Require a boolean, accepting the strings `true` and `false`.
 *
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean}
 * @throws {import('./errors.js').ApiError} 400 when not boolean-like.
 */
export function requireBoolean(value, field) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw badRequest(`Missing or invalid required field: ${field}`);
}

/**
 * Accept a boolean or fall back to a default.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {boolean|undefined} [fallback]
 * @returns {boolean|undefined}
 */
export function optionalBoolean(value, field, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  return requireBoolean(value, field);
}

/**
 * Require one of a fixed set of values.
 *
 * @template T
 * @param {unknown} value
 * @param {string} field
 * @param {T[]} allowed
 * @returns {T}
 * @throws {import('./errors.js').ApiError} 400 when not allowed.
 */
export function requireEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw badRequest(`Invalid value for ${field}: must be one of ${allowed.join(', ')}`);
  }
  return value;
}

/**
 * Accept one of a fixed set of values, or fall back to a default.
 *
 * @template T
 * @param {unknown} value
 * @param {string} field
 * @param {T[]} allowed
 * @param {T|undefined} [fallback]
 * @returns {T|undefined}
 */
export function optionalEnum(value, field, allowed, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  return requireEnum(value, field, allowed);
}

/**
 * Require an array with a minimum length.
 *
 * @param {unknown} value
 * @param {string} field
 * @param {{min?: number}} [bounds]
 * @returns {unknown[]}
 * @throws {import('./errors.js').ApiError} 400 when missing or too short.
 */
export function requireArray(value, field, { min = 1 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    throw badRequest(`Missing or invalid required field: ${field}`);
  }
  return value;
}
