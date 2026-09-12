/**
 * A virtual clock. Tests and the /__mock/clock endpoint can jump time forward
 * without waiting, which is the only sane way to exercise 30 day bundles.
 */
class Clock {
  #offsetMs = 0;

  /**
   * Current virtual time.
   *
   * @returns {number} Milliseconds since the epoch, including the offset.
   */
  now() {
    return Date.now() + this.#offsetMs;
  }

  /**
   * Current virtual time as a Date.
   *
   * @returns {Date}
   */
  date() {
    return new Date(this.now());
  }

  /**
   * RFC 3339 / UTC, the format every eSIM Go timestamp uses.
   *
   * @param {number} [at] Timestamp to format; defaults to now.
   * @returns {string} e.g. `2026-09-12T18:21:19.723Z`
   */
  iso(at = this.now()) {
    return new Date(at).toISOString();
  }

  /**
   * Same instant with nanosecond digits, the way eSIM Go's Go backend renders
   * some fields.
   *
   * @param {number} [at] Timestamp to format; defaults to now.
   * @returns {string} e.g. `2026-09-12T18:21:19.723000000Z`
   */
  isoNano(at = this.now()) {
    return new Date(at).toISOString().replace(/Z$/, '000000Z');
  }

  /**
   * Move the clock forward.
   *
   * @param {number} ms Milliseconds to add.
   * @returns {number} The new offset.
   */
  advanceMs(ms) {
    this.#offsetMs += ms;
    return this.#offsetMs;
  }

  /**
   * Move the clock forward.
   *
   * @param {number} seconds Seconds to add.
   * @returns {number} The new offset.
   */
  advanceSeconds(seconds) {
    return this.advanceMs(seconds * 1000);
  }

  /**
   * Snap back to real time.
   *
   * @returns {void}
   */
  reset() {
    this.#offsetMs = 0;
  }

  /**
   * Current offset from real time.
   *
   * @returns {number} Milliseconds.
   */
  get offset() {
    return this.#offsetMs;
  }
}

export const clock = new Clock();

/** One day in milliseconds. */
export const DAY_MS = 86400000;

/**
 * Add whole days to a timestamp.
 *
 * @param {number} at Base timestamp.
 * @param {number} days Days to add.
 * @returns {number} The shifted timestamp.
 */
export const addDays = (at, days) => at + days * DAY_MS;

/**
 * Date portion of a timestamp, as used by inventory expiry fields.
 *
 * @param {number} at
 * @returns {string} `YYYY-MM-DD`
 */
export const dateOnly = (at) => new Date(at).toISOString().slice(0, 10);
