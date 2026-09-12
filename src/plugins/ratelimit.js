import { config } from '../config.js';
import { tooManyRequests } from '../util/errors.js';

/**
 * Fixed window rate limiting, per source IP.
 *
 * eSIM Go documents 10 requests per second per IP with a token cost per
 * endpoint, and returns the window state in `X-Ratelimit-*` headers on every
 * response - including successful ones.
 */

/** Token cost per route, keyed by the Fastify route pattern. Default is 1. */
const ROUTE_COST = new Map([
  ['/catalogue', 5],
  ['/catalogue/prices', 5],
  ['/networks', 5],
  ['/orders', 2],
  ['/esims/apply', 2],
  ['/esims/assignments', 2],
]);

/** @type {Map<string, {windowStart: number, used: number}>} */
const buckets = new Map();

/**
 * Token cost of a request.
 *
 * @param {import('fastify').FastifyRequest} request
 * @returns {number} Cost in tokens.
 */
export function costOf(request) {
  const route = String(request.routeOptions?.url ?? request.url).replace(config.basePath, '');
  return ROUTE_COST.get(route) ?? 1;
}

/**
 * Fastify `onRequest` hook applying the limiter and setting the headers.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} reply
 * @returns {Promise<void>}
 * @throws {import('../util/errors.js').ApiError} 429 when the window is exhausted.
 */
export async function rateLimitHook(request, reply) {
  if (!config.rateLimit.enabled) return;

  const { limit, windowMs } = config.rateLimit;
  const now = Date.now();
  const key = request.ip ?? 'unknown';
  const cost = costOf(request);

  let bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    bucket = { windowStart: now, used: 0 };
    buckets.set(key, bucket);
  }

  const resetAt = new Date(bucket.windowStart + windowMs).toISOString();
  reply.header('X-Ratelimit-Limit', String(limit));
  reply.header('X-Ratelimit-Cost', String(cost));
  reply.header('X-Ratelimit-Reset', resetAt);

  if (bucket.used + cost > limit) {
    reply.header('X-Ratelimit-Remaining', String(Math.max(0, limit - bucket.used)));
    reply.header('Retry-After', String(Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000))));
    throw tooManyRequests('Rate limit exceeded');
  }

  bucket.used += cost;
  reply.header('X-Ratelimit-Remaining', String(Math.max(0, limit - bucket.used)));
}

/**
 * Drop every window. Used by the control plane and by tests.
 *
 * @returns {void}
 */
export const resetRateLimits = () => buckets.clear();
