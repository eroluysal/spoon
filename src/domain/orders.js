import { state } from '../store/state.js';
import { badRequest } from '../util/errors.js';
import { clock } from '../util/time.js';
import { uuid } from '../util/ids.js';
import { requireEsim, createEsim, isCompatible, DEFAULT_BRANDING_ID } from './esims.js';
import { createAssignment, requireBundle, stockBundle } from './bundles.js';
import { debit, balance } from './organisation.js';

/**
 * Orders.
 *
 * `type: validate` prices an order without touching anything; `type:
 * transaction` charges the organisation balance and either stocks inventory
 * (`assign: false`) or provisions eSIMs and applies bundles (`assign: true`).
 */

/** Round money to cents. */
const money = (value) => Math.round(value * 100) / 100;

/**
 * Validate and normalise one order line.
 *
 * @param {object} line Raw order line from the request body.
 * @param {boolean} assign Whether the order assigns bundles to eSIMs.
 * @returns {{type: string, item: string, quantity: number, iccids: string[], allowReassign: boolean, bundle: object}}
 * @throws {import('../util/errors.js').ApiError} 400 on any rule violation.
 */
function normaliseLine(line, assign) {
  if (line === null || typeof line !== 'object') throw badRequest('Invalid order line');
  if (line.type !== undefined && line.type !== 'bundle') {
    throw badRequest(`Invalid order type ${line.type}: only bundle is supported`);
  }

  const bundle = requireBundle(line.item);
  const iccids = Array.isArray(line.iccids) ? line.iccids.map(String) : [];

  if (iccids.length > 0 && !assign) {
    throw badRequest('eSIM ICCIDs can only be specified when assign is set to true');
  }

  const quantity = line.quantity === undefined ? iccids.length || 1 : Number(line.quantity);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw badRequest('Missing or invalid required field: quantity');
  }
  if (iccids.length > 0 && iccids.length !== quantity) {
    throw badRequest(
      `Quantity (${quantity}) must match the number of ICCIDs provided (${iccids.length})`,
    );
  }

  const allowReassign = Boolean(line.allowReassign);

  for (const iccid of iccids) {
    const esim = requireEsim(iccid);
    if (esim.state === 'deactivated') {
      throw badRequest(`eSIM ${iccid} has been deactivated and cannot take new bundles`);
    }
    if (!allowReassign && !isCompatible(iccid, bundle.name)) {
      throw badRequest(
        `Bundle ${bundle.name} is not compatible with eSIM ${iccid}. Set allowReassign to true to assign a new profile.`,
      );
    }
  }

  return { type: 'bundle', item: bundle.name, quantity, iccids, allowReassign, bundle };
}

/**
 * Parse and validate an order request body.
 *
 * @param {object} body Request body of POST /orders.
 * @returns {{type: string, assign: boolean, profileID: string|undefined, lines: object[], total: number}}
 */
export function parseOrder(body) {
  if (body === null || typeof body !== 'object') throw badRequest('Invalid request body');

  const type = body.type ?? 'validate';
  if (!['validate', 'transaction'].includes(type)) {
    throw badRequest('Invalid value for type: must be one of validate, transaction');
  }

  const assign = Boolean(body.assign);
  const rawLines = body.order ?? body.Order;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw badRequest('Missing or invalid required field: order');
  }

  const profileID = body.profileID ?? body.profileId;
  if (profileID !== undefined && !assign) {
    throw badRequest('profileID can only be used when assign is set to true');
  }

  const lines = rawLines.map((line) => normaliseLine(line, assign));
  const total = money(lines.reduce((sum, line) => sum + line.bundle.price * line.quantity, 0));

  return { type, assign, profileID, lines, total };
}

/**
 * Price an order without side effects (POST /orders with `type: validate`).
 *
 * @param {object} parsed Result of {@link parseOrder}.
 * @returns {object} OrderResponseValidate payload.
 */
export function validateOrder(parsed) {
  return {
    order: parsed.lines.map((line) => ({
      type: line.type,
      item: line.item,
      quantity: line.quantity,
      subTotal: money(line.bundle.price * line.quantity),
      pricePerUnit: line.bundle.price,
      AllowReassign: line.allowReassign,
    })),
    total: parsed.total,
    valid: true,
    currency: state.organisation.currency,
    createdDate: clock.isoNano(),
    assigned: parsed.assign,
  };
}

/**
 * Execute an order (POST /orders with `type: transaction`).
 *
 * @param {object} parsed Result of {@link parseOrder}.
 * @param {{sourceIP?: string}} [context] Request metadata recorded on the order.
 * @returns {object} The stored order record.
 */
export function processOrder(parsed, context = {}) {
  debit(parsed.total, 'order');

  const orderReference = uuid();
  const now = clock.now();
  const items = [];
  let assignedCount = 0;

  for (const line of parsed.lines) {
    const item = {
      type: line.type,
      item: line.item,
      quantity: line.quantity,
      subTotal: money(line.bundle.price * line.quantity),
      pricePerUnit: line.bundle.price,
      AllowReassign: line.allowReassign,
      iccids: [],
      esims: [],
    };

    if (!parsed.assign) {
      // Nothing is provisioned: the bundles land in inventory for later use.
      stockBundle(line.bundle, line.quantity, orderReference);
      items.push(item);
      continue;
    }

    for (let i = 0; i < line.quantity; i += 1) {
      const targetIccid = line.iccids[i];
      const esim = targetIccid
        ? requireEsim(targetIccid)
        : createEsim({
            orderReference,
            brandingId: parsed.profileID ?? DEFAULT_BRANDING_ID,
            profileName: line.bundle.profileName,
          });

      // Ordered stock is booked in and immediately drawn down by the assignment.
      const stock = stockBundle(line.bundle, 1, orderReference);
      stock.remaining -= 1;
      createAssignment(esim, line.bundle, {
        reference: orderReference,
        index: i,
        inventoryItem: stock,
      });

      item.iccids.push(esim.iccid);
      item.esims.push({
        iccid: esim.iccid,
        matchingId: esim.matchingId,
        smdpAddress: esim.smdpAddress,
      });
      assignedCount += 1;
    }

    items.push(item);
  }

  const order = {
    orderReference,
    createdDate: clock.isoNano(now),
    createdAt: now,
    total: parsed.total,
    currency: state.organisation.currency,
    status: 'completed',
    statusMessage: parsed.assign
      ? `Order completed: ${assignedCount} eSIM${assignedCount === 1 ? '' : 's'} assigned`
      : `Order completed: ${parsed.lines.reduce((sum, line) => sum + line.quantity, 0)} bundles added to inventory`,
    assigned: parsed.assign,
    sourceIP: context.sourceIP ?? '127.0.0.1',
    runningBalance: String(balance()),
    profileID: parsed.profileID,
    brandingId: parsed.profileID ?? `${DEFAULT_BRANDING_ID} (default)`,
    items,
  };

  state.orders.set(orderReference, order);
  state.references.set(orderReference, {
    reference: orderReference,
    kind: 'order',
    iccids: items.flatMap((item) => item.iccids),
    bundleNames: [...new Set(items.map((item) => item.item))],
    createdAt: now,
  });

  return order;
}

/**
 * Wire format for one order.
 *
 * @param {object} order Stored order.
 * @param {{includeIccids?: boolean}} [options] Include eSIM details and the ICCID array.
 * @returns {object} OrderResponseTransaction payload.
 */
export function orderPayload(order, options = {}) {
  const includeIccids = options.includeIccids ?? false;
  return {
    order: order.items.map((item) => ({
      ...(includeIccids ? { esims: item.esims } : {}),
      type: item.type,
      item: item.item,
      ...(includeIccids ? { iccids: item.iccids } : {}),
      quantity: item.quantity,
      subTotal: item.subTotal,
      pricePerUnit: item.pricePerUnit,
      AllowReassign: item.AllowReassign,
    })),
    total: order.total,
    currency: order.currency,
    status: order.status,
    statusMessage: order.statusMessage,
    orderReference: order.orderReference,
    createdDate: order.createdDate,
    assigned: order.assigned,
    sourceIP: order.sourceIP,
    runningBalance: order.runningBalance,
    ...(order.brandingId ? { brandingId: order.brandingId } : {}),
  };
}

/**
 * Fetch an order by reference.
 *
 * @param {string} orderReference
 * @returns {object} The stored order.
 * @throws {import('../util/errors.js').ApiError} 400 when unknown.
 */
export function requireOrder(orderReference) {
  const order = state.orders.get(String(orderReference));
  if (!order) throw badRequest(`No order found with reference ${orderReference}`);
  return order;
}

/**
 * Orders newest first, optionally filtered by creation date.
 *
 * The `createdAt` query parameter uses the live API's comparator prefixes,
 * e.g. `gte:2026-03-01T00:00:00Z` or `lte:2026-03-31T23:59:59Z`.
 *
 * @param {{createdAt?: string}} [filters]
 * @returns {object[]} Matching orders.
 */
export function listOrders(filters = {}) {
  let orders = [...state.orders.values()].sort((a, b) => b.createdAt - a.createdAt);
  const raw = filters.createdAt;
  if (!raw) return orders;

  const match = /^(lte|gte|lt|gt|eq):(.+)$/.exec(String(raw));
  const [, comparator, value] = match ?? [undefined, 'eq', String(raw)];
  const boundary = Date.parse(value);
  if (Number.isNaN(boundary)) throw badRequest('Invalid value for parameter createdAt');

  const predicates = {
    lte: (at) => at <= boundary,
    lt: (at) => at < boundary,
    gte: (at) => at >= boundary,
    gt: (at) => at > boundary,
    eq: (at) => at === boundary,
  };
  return orders.filter((order) => predicates[comparator](order.createdAt));
}
