import { randomUUID, randomInt } from 'node:crypto';

/** Industry prefix (89) + country code + issuer, matching eSIM Go's 8943108... range. */
const ICCID_PREFIX = '89431081';

/**
 * Luhn check digit for an ICCID body.
 *
 * @param {string} digits ICCID without its check digit.
 * @returns {number} The check digit, 0-9.
 */
function luhnCheckDigit(digits) {
  let sum = 0;
  let double = true; // the check digit sits in an even position, so start doubling
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    double = !double;
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Whether a string is a structurally valid, Luhn-correct ICCID.
 *
 * @param {string} iccid
 * @returns {boolean}
 */
export function isValidIccid(iccid) {
  if (!/^\d{18,20}$/.test(iccid)) return false;
  const body = iccid.slice(0, -1);
  return luhnCheckDigit(body) === Number(iccid.slice(-1));
}

let iccidSequence = 1;
let assignmentSequence = 215009266;
let usageIdSequence = 4500100;
let topupRefSequence = 987654321;

/** Sequential, Luhn valid, 19 digit ICCIDs. */
export function nextIccid() {
  const serial = String(iccidSequence++).padStart(10, '0');
  const body = `${ICCID_PREFIX}${serial}`;
  return `${body}${luhnCheckDigit(body)}`;
}

const MATCHING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Random block of matching-id characters (ambiguous glyphs excluded).
 *
 * @param {number} length
 * @returns {string}
 */
function block(length) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += MATCHING_ALPHABET[randomInt(MATCHING_ALPHABET.length)];
  return out;
}

/**
 * SM-DP+ activation code token.
 *
 * @returns {string} e.g. `K2-4CVQ7B-9MZXTLA`
 */
export const nextMatchingId = () => `${block(2)}-${block(6)}-${block(7)}`;

/**
 * The activation string a real eSIM QR code encodes.
 *
 * @param {string} smdpAddress SM-DP+ hostname.
 * @param {string} matchingId Activation token.
 * @returns {string} e.g. `LPA:1$rsp.example.com$K2-4CVQ7B-9MZXTLA`
 */
export const lpaString = (smdpAddress, matchingId) => `LPA:1$${smdpAddress}$${matchingId}`;

/**
 * iOS 17.4+ one-tap install deep link.
 *
 * @param {string} smdpAddress
 * @param {string} matchingId
 * @returns {string}
 */
export const appleInstallUrl = (smdpAddress, matchingId) =>
  `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${lpaString(smdpAddress, matchingId)}`;

/**
 * Android one-tap install deep link.
 *
 * @param {string} smdpAddress
 * @param {string} matchingId
 * @returns {string}
 */
export const androidInstallUrl = (smdpAddress, matchingId) =>
  `https://esimsetup.android.com/esim_qrcode_provisioning?carddata=${lpaString(smdpAddress, matchingId)}`;

/**
 * Next bundle assignment id.
 *
 * @returns {string} Numeric string, as the live API returns it.
 */
export const nextAssignmentId = () => String(assignmentSequence++);

/**
 * Next inventory batch id (`usageId`).
 *
 * @returns {number}
 */
export const nextUsageId = () => usageIdSequence++;

/**
 * Next balance top-up reference.
 *
 * @returns {number}
 */
export const nextTopupRef = () => topupRefSequence++;

/**
 * Order / apply reference.
 *
 * @returns {string} UUID v4.
 */
export const uuid = () => randomUUID();

/**
 * MSISDN assigned to voice/SMS capable eSIMs.
 *
 * @returns {string}
 */
export const nextMsisdn = () => `4467890${randomInt(100000, 999999)}`;

/**
 * SIM PIN.
 *
 * @returns {string} Four digits.
 */
export const pin = () => String(randomInt(0, 10000)).padStart(4, '0');

/**
 * SIM PUK.
 *
 * @returns {string} Eight digits.
 */
export const puk = () => String(randomInt(10000000, 99999999));

/**
 * Reset the counters so a state reset produces reproducible identifiers.
 *
 * @returns {void}
 */
export function resetSequences() {
  iccidSequence = 1;
  assignmentSequence = 215009266;
  usageIdSequence = 4500100;
  topupRefSequence = 987654321;
}
