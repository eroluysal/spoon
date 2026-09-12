import { badRequest } from './errors.js';

/**
 * Parse and validate `page` / `perPage` query parameters.
 *
 * @param {unknown} rawPage Raw `page` value.
 * @param {unknown} rawPerPage Raw `perPage` (or `limit`) value.
 * @param {object} [opts]
 * @param {number} [opts.defaultPerPage] Page size when none is given.
 * @param {number[]} [opts.allowed] Restrict page size to these values (GET /esims does).
 * @param {number} [opts.maxPerPage] Upper bound applied silently.
 * @returns {{page: number, perPage: number}}
 * @throws {import('./errors.js').ApiError} 400 on a non-integer or out of range value.
 */
export function parsePage(rawPage, rawPerPage, opts = {}) {
  const { defaultPerPage = 50, allowed, maxPerPage = 1000 } = opts;

  let page = 1;
  if (rawPage !== undefined && rawPage !== '') {
    page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1) throw badRequest('Invalid value for parameter page');
  }

  let perPage = defaultPerPage;
  if (rawPerPage !== undefined && rawPerPage !== '') {
    perPage = Number(rawPerPage);
    if (!Number.isInteger(perPage) || perPage < 1) {
      throw badRequest('Invalid value for parameter perPage');
    }
    if (allowed && !allowed.includes(perPage)) {
      throw badRequest(`perPage must be one of ${allowed.join(', ')}`);
    }
    if (perPage > maxPerPage) perPage = maxPerPage;
  }

  return { page, perPage };
}

/**
 * Slice one page out of a list.
 *
 * @template T
 * @param {T[]} items
 * @param {{page: number, perPage: number}} page
 * @returns {T[]}
 */
export function paginate(items, { page, perPage }) {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}

/**
 * Sort a list by one property, numerically or lexicographically.
 *
 * @template T
 * @param {T[]} items
 * @param {string|undefined} key Property to sort on; undefined leaves the order alone.
 * @param {unknown} direction `asc` (default) or `desc`.
 * @returns {T[]} A new, sorted array.
 */
export function sortBy(items, key, direction) {
  if (!key) return items;
  const desc = String(direction ?? 'asc').toLowerCase() === 'desc';
  return [...items].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === bv) return 0;
    const cmp =
      typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av ?? '').localeCompare(String(bv ?? ''));
    return desc ? -cmp : cmp;
  });
}
