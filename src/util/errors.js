/**
 * eSIM Go reports every failure as `{"message": "..."}` with a bare HTTP status.
 * ApiError carries the status through Fastify's error handler untouched.
 */
export class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status to answer with.
   * @param {string} message Message placed in the response body.
   */
  constructor(statusCode, message) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

/**
 * 400 - malformed body or a failed validation rule.
 *
 * @param {string} message
 * @returns {ApiError}
 */
export const badRequest = (message) => new ApiError(400, message);

/**
 * 403 - missing/invalid API key, non-whitelisted IP, or a resource that belongs
 * to another organisation. eSIM Go never answers 401.
 *
 * @param {string} [message]
 * @returns {ApiError}
 */
export const forbidden = (message = 'Forbidden') => new ApiError(403, message);

/**
 * 404 - no such route or resource.
 *
 * @param {string} [message]
 * @returns {ApiError}
 */
export const notFound = (message = 'Not Found') => new ApiError(404, message);

/**
 * 410 - the resource existed but is gone, e.g. install details for a
 * deactivated eSIM.
 *
 * @param {string} [message]
 * @returns {ApiError}
 */
export const gone = (message = 'Gone') => new ApiError(410, message);

/**
 * 429 - rate limit window exhausted.
 *
 * @param {string} [message]
 * @returns {ApiError}
 */
export const tooManyRequests = (message = 'Rate limit exceeded') => new ApiError(429, message);

/**
 * 500 - unexpected server side failure.
 *
 * @param {string} [message]
 * @returns {ApiError}
 */
export const serverError = (message = 'Server Error') => new ApiError(500, message);

/**
 * 503 - processing; clients should retry after the `Retry-After` header.
 *
 * @param {string} [message]
 * @returns {ApiError}
 */
export const unavailable = (message = 'Service Unavailable') => new ApiError(503, message);
