import { state } from '../store/state.js';
import { badRequest } from '../util/errors.js';
import { clock } from '../util/time.js';
import { nextTopupRef } from '../util/ids.js';
import { sendBalanceThreshold, sendTopup } from '../callbacks/dispatcher.js';

/**
 * Organisation, balance and bundle group operations.
 *
 * eSIM Go is pre-paid: every order is debited from the organisation balance,
 * refunds credit it back, and crossing the low balance threshold fires a
 * `LowBalance` / `InsufficientBalance` callback.
 */

/** Round to cents; balances are money, not floats. */
const money = (value) => Math.round(value * 100) / 100;

/**
 * The organisation record backing GET /organisation.
 *
 * @returns {object}
 */
export const organisation = () => state.organisation;

/**
 * GET /organisation response, with mock-only fields stripped out.
 *
 * @returns {object} Organisation in wire format.
 */
export function organisationPayload() {
  const { lowBalanceThreshold, callbackVersion, ...rest } = state.organisation;
  return { ...rest, balance: money(rest.balance), testCredit: money(rest.testCredit) };
}

/**
 * Current spendable balance (test credit included, as the live API reports it).
 *
 * @returns {number}
 */
export const balance = () => money(state.organisation.balance);

/**
 * Check whether an amount can be charged without going negative.
 *
 * @param {number} amount
 * @returns {boolean}
 */
export const canAfford = (amount) => state.organisation.balance + 1e-9 >= amount;

/**
 * Debit the organisation balance, firing a balance callback when the result
 * drops to or below the configured threshold.
 *
 * @param {number} amount Amount to charge.
 * @param {string} [reason] Free text used in the error message.
 * @returns {number} The new balance.
 * @throws {import('../util/errors.js').ApiError} 400 when the balance is insufficient.
 */
export function debit(amount, reason = 'order') {
  if (!canAfford(amount)) {
    throw badRequest(
      `Insufficient balance to complete ${reason}: required ${money(amount)} ${state.organisation.currency}, available ${balance()}`,
    );
  }
  const org = state.organisation;
  org.balance = money(org.balance - amount);
  if (org.balance <= org.lowBalanceThreshold) {
    void sendBalanceThreshold(org.balance, org.lowBalanceThreshold);
  }
  return org.balance;
}

/**
 * Credit the organisation balance (refunds, revokes with refundToBalance).
 *
 * @param {number} amount
 * @returns {number} The new balance.
 */
export function credit(amount) {
  const org = state.organisation;
  org.balance = money(org.balance + amount);
  return org.balance;
}

/**
 * Top up the balance from the saved card (POST /organisation/balance).
 *
 * @param {number} amount Amount to charge to the saved card.
 * @returns {{amount: number, balance: number, ref: number}} Wire format response.
 */
export function topup(amount) {
  if (!(amount > 0)) throw badRequest('Invalid value for parameter amount');
  const org = state.organisation;
  const before = org.balance;
  org.balance = money(org.balance + amount);
  const record = { amount: money(amount), balance: org.balance, ref: nextTopupRef(), at: clock.iso() };
  state.topups.push(record);
  void sendTopup(money(before), org.balance);
  return { amount: record.amount, balance: record.balance, ref: record.ref };
}

/**
 * Bundle groups assigned to the organisation (GET /organisation/groups).
 *
 * @returns {{groups: {name: string, priceListUrl: string, desc: string, icon: string}[]}}
 */
export function bundleGroups() {
  return {
    groups: state.groups
      .filter((group) => state.organisation.groups.includes(group.name))
      .map((group) => ({
        name: group.name,
        priceListUrl: group.priceListUrl,
        desc: group.desc,
        icon: group.icon,
      })),
  };
}
