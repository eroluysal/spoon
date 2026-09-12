import { randomUUID } from 'node:crypto';
import { state } from '../store/state.js';
import { ApiError } from '../util/errors.js';

/**
 * Failure injection.
 *
 * Clients need to exercise their retry and error paths, so the control plane
 * can arm rules that make any route answer with a chosen status for a chosen
 * number of calls, optionally after a delay.
 */

/**
 * Arm a failure rule.
 *
 * @param {object} rule
 * @param {string} rule.path Path to match, without the base prefix (e.g. `/esims`). `*` matches everything.
 * @param {string} [rule.method] HTTP method to match; omit for any.
 * @param {number} [rule.status] Status to return (default 500).
 * @param {string} [rule.message] Error message body (default `Server Error`).
 * @param {number} [rule.count] How many times the rule fires; omit for unlimited.
 * @param {number} [rule.delayMs] Delay applied before responding.
 * @returns {object} The stored rule.
 */
export function addFailure(rule) {
  const stored = {
    id: randomUUID(),
    path: rule.path ?? '*',
    method: rule.method ? String(rule.method).toUpperCase() : undefined,
    status: rule.status ?? 500,
    message: rule.message ?? 'Server Error',
    remaining: rule.count,
    delayMs: rule.delayMs,
  };
  state.failures.push(stored);
  return stored;
}

/**
 * Remove one rule, or all of them.
 *
 * @param {string} [id] Rule id; omit to clear every rule.
 * @returns {number} How many rules were removed.
 */
export function removeFailure(id) {
  if (!id) {
    const count = state.failures.length;
    state.failures.length = 0;
    return count;
  }
  const index = state.failures.findIndex((rule) => rule.id === id);
  if (index === -1) return 0;
  state.failures.splice(index, 1);
  return 1;
}

/**
 * Find the first rule matching a request.
 *
 * @param {string} method HTTP method.
 * @param {string} path Request path with the base prefix stripped.
 * @returns {object|undefined} The matching rule.
 */
export function matchFailure(method, path) {
  return state.failures.find((rule) => {
    if (rule.method && rule.method !== method) return false;
    if (rule.path === '*') return true;
    return path === rule.path || path.startsWith(`${rule.path}/`);
  });
}

/**
 * Fastify `onRequest` hook applying armed failure rules.
 *
 * @param {import('fastify').FastifyRequest} request
 * @param {import('fastify').FastifyReply} _reply
 * @returns {Promise<void>}
 * @throws {ApiError} The status and message configured on the matching rule.
 */
export async function failureHook(request, _reply) {
  if (state.failures.length === 0) return;

  const path = request.url.split('?')[0].replace(request.server.esimgoBasePath ?? '', '') || '/';
  const rule = matchFailure(request.method, path);
  if (!rule) return;

  if (rule.remaining !== undefined) {
    rule.remaining -= 1;
    if (rule.remaining <= 0) removeFailure(rule.id);
  }
  if (rule.delayMs) await new Promise((resolve) => setTimeout(resolve, rule.delayMs));
  throw new ApiError(rule.status, rule.message);
}
