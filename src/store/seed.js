import { config } from '../config.js';
import { state, getCatalogueBundle } from '../store/state.js';
import { createEsim, attachToNetwork, markInstalled } from '../domain/esims.js';
import { createAssignment, promoteAssignment, consume, startAssignment } from '../domain/bundles.js';
import { addStock } from '../domain/inventory.js';
import { uuid } from '../util/ids.js';
import { clock } from '../util/time.js';

/**
 * Demo data created on boot so a fresh mock is immediately useful: some stock
 * in inventory and a handful of eSIMs in different states.
 */

/** Bundles pre-stocked in inventory. */
const SEED_STOCK = [
  ['esim_1GB_7D_GB_V2', 25],
  ['esim_5GB_30D_GB_V2', 10],
  ['esim_10GB_30D_EU_V2', 10],
  ['esim_ULTD_7D_TR_U', 5],
  ['esim_5GB_30D_US_VS', 5],
];

/**
 * Put the configured demo stock into inventory.
 *
 * @returns {object[]} The inventory rows created.
 */
export function seedInventory() {
  const rows = [];
  for (const [name, quantity] of SEED_STOCK) {
    const bundle = getCatalogueBundle(name);
    if (!bundle) continue;
    rows.push(addStock(name, quantity, bundle.price));
  }
  return rows;
}

/**
 * Create demo eSIMs: one active and consuming data, one freshly ordered and
 * still queued, one with no bundle at all.
 *
 * @param {number} count How many eSIMs to create.
 * @returns {object[]} The eSIMs created.
 */
export function seedEsims(count) {
  const created = [];
  const reference = uuid();

  for (let i = 0; i < count; i += 1) {
    const bundleName = i % 2 === 0 ? 'esim_1GB_7D_GB_V2' : 'esim_10GB_30D_EU_V2';
    const bundle = getCatalogueBundle(bundleName);
    const esim = createEsim({
      customerRef: `SEED-${String(i + 1).padStart(3, '0')}`,
      profileName: bundle?.profileName ?? 'Profile 1',
      applyReference: reference,
    });
    created.push(esim);

    if (!bundle || i === count - 1) continue; // the last eSIM stays bundle-free

    const stock = addStock(bundleName, 1, bundle.price);
    stock.remaining -= 1;
    const assignment = createAssignment(esim, bundle, {
      reference,
      index: i,
      inventoryItem: stock,
    });

    if (i === 0) {
      // First eSIM looks like a live one: installed, attached and 30% used.
      markInstalled(esim.iccid);
      promoteAssignment(assignment, { force: true });
      startAssignment(assignment);
      attachToNetwork(esim.iccid, bundle.countries[0]?.iso);
      consume(assignment, Math.round(assignment.initialQuantity * 0.3));
    }
  }

  state.references.set(reference, {
    reference,
    kind: 'apply',
    iccids: created.map((esim) => esim.iccid),
    bundleNames: [...new Set(created.map(() => 'esim_1GB_7D_GB_V2'))],
    createdAt: clock.now(),
  });

  return created;
}

/**
 * Seed everything enabled in configuration.
 *
 * @returns {{inventory: number, esims: number}} What was created.
 */
export function seedAll() {
  const inventory = config.seed.inventory ? seedInventory().length : 0;
  const esims = config.seed.esims > 0 ? seedEsims(config.seed.esims).length : 0;
  return { inventory, esims };
}
