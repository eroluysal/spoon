import { config } from '../config.js';
import { forbidden } from '../util/errors.js';

/**
 * API key authentication and IP whitelisting.
 *
 * eSIM Go expects the key in `X-API-Key` (header names are case insensitive)
 * and answers 403 for a missing key, a wrong key, or a source IP that is not
 * whitelisted - never 401.
 */

/**
 * Whether a request carries a valid API key.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function hasValidApiKey(request) {
  const key = request.headers['x-api-key'];
  const provided = Array.isArray(key) ? key[0] : key;
  return typeof provided === 'string' && config.apiKeys.includes(provided);
}

/**
 * Whether the caller's IP passes the configured whitelist.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {boolean}
 */
export function isWhitelisted(request) {
  if (config.ipWhitelist.length === 0) return true;
  const ip = request.ip ?? '';
  const normalised = ip.replace(/^::ffff:/, '');
  return config.ipWhitelist.includes(ip) || config.ipWhitelist.includes(normalised);
}

/**
 * Fastify `onRequest` hook enforcing authentication on the API surface.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} _reply
 * @returns {Promise<void>}
 * @throws {import('../util/errors.js').ApiError} 403 when the key or IP is rejected.
 */
export async function authHook(request, _reply) {
  if (!isWhitelisted(request)) throw forbidden('Forbidden');
  if (!hasValidApiKey(request)) throw forbidden('Forbidden');
}
