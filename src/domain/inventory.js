import { state, getCatalogueBundle, availableInventory } from '../store/state.js';
import { badRequest } from '../util/errors.js';
import { clock, addDays, dateOnly } from '../util/time.js';
import { nextUsageId } from '../util/ids.js';
import { config } from '../config.js';
import { credit } from './organisation.js';

/**
 * Bundle inventory.
 *
 * Ordering a bundle without assigning it puts stock into inventory; applying a
 * bundle to an eSIM draws that stock down. Revoked bundles go back to inventory
 * (or to the balance, when `refundToBalance` is used).
 */

/**
 * Add stock for a bundle.
 *
 * @param {string} bundleName Catalogue bundle name.
 * @param {number} quantity How many to add.
 * @param {number} pricePerUnit Price paid per unit, used when refunding.
 * @param {string} [orderReference] Order that created the stock.
 * @returns {object} The inventory row.
 */
export function addStock(bundleName, quantity, pricePerUnit, orderReference) {
  const item = {
    usageId: nextUsageId(),
    bundleName,
    total: quantity,
    remaining: quantity,
    expiry: dateOnly(addDays(clock.now(), config.simulation.inventoryExpiryDays)),
    pricePerUnit,
    orderReference,
    createdAt: clock.now(),
  };
  state.inventory.set(item.usageId, item);
  return item;
}

/**
 * Take one unit of a bundle out of inventory, oldest expiry first.
 *
 * @param {string} bundleName
 * @returns {object|undefined} The inventory row drawn from, or undefined when out of stock.
 */
export function drawStock(bundleName) {
  const [item] = availableInventory(bundleName);
  if (!item) return undefined;
  item.remaining -= 1;
  return item;
}

/**
 * Put one unit back into inventory, re-creating the row if it has been purged.
 *
 * @param {string} bundleName
 * @param {number} [usageId] Row the unit originally came from.
 * @param {number} [pricePerUnit] Price to record when a new row has to be created.
 * @returns {object} The inventory row that received the unit.
 */
export function returnStock(bundleName, usageId, pricePerUnit = 0) {
  const existing = usageId !== undefined ? state.inventory.get(usageId) : undefined;
  if (existing && existing.bundleName === bundleName) {
    existing.remaining += 1;
    existing.total = Math.max(existing.total, existing.remaining);
    return existing;
  }
  return addStock(bundleName, 1, pricePerUnit);
}

/**
 * Refund unused inventory back to the organisation balance
 * (POST /inventory/refund).
 *
 * @param {number} usageId Inventory row id, as returned by GET /inventory.
 * @param {number} quantity How many units to refund.
 * @returns {{refunded: number, credited: number, item: object}} Refund result.
 * @throws {import('../util/errors.js').ApiError} 400 for an unknown row or too large a quantity.
 */
export function refundStock(usageId, quantity) {
  const item = state.inventory.get(usageId);
  if (!item) throw badRequest(`No inventory found for usageId ${usageId}`);
  if (quantity > item.remaining) {
    throw badRequest(
      `Cannot refund ${quantity} bundles: only ${item.remaining} remaining for usageId ${usageId}`,
    );
  }
  item.remaining -= quantity;
  const credited = Math.round(item.pricePerUnit * quantity * 100) / 100;
  credit(credited);
  if (item.remaining === 0) state.inventory.delete(usageId);
  return { refunded: quantity, credited, item };
}

/**
 * GET /inventory payload: one row per bundle, with its available batches.
 *
 * @returns {{bundles: object[]}} Inventory in wire format.
 */
export function inventoryPayload() {
  /** @type {Map<string, object>} */
  const byBundle = new Map();

  for (const item of [...state.inventory.values()].sort((a, b) => a.createdAt - b.createdAt)) {
    const bundle = getCatalogueBundle(item.bundleName);
    if (!byBundle.has(item.bundleName)) {
      byBundle.set(item.bundleName, {
        name: item.bundleName,
        desc: bundle?.description ?? item.bundleName,
        useDms: false,
        available: [],
        countries: bundle ? bundle.countries.map((c) => c.iso) : [],
        data: bundle?.dataAmount ?? 0,
        duration: bundle?.duration ?? 0,
        durationUnit: 'day',
        autostart: bundle?.autostart ?? false,
        unlimited: bundle?.unlimited ?? false,
        speed: bundle?.speed ?? [],
        allowances: bundle?.allowances ?? [],
      });
    }
    byBundle.get(item.bundleName).available.push({
      id: item.usageId,
      total: item.total,
      remaining: item.remaining,
      expiry: item.expiry,
    });
  }

  return { bundles: [...byBundle.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}
