/**
 * Render rows as CSV. eSIM Go quotes every field, including the header row.
 *
 * @param {Array<Array<string|number|boolean|null|undefined>>} rows Header row first.
 * @returns {string} CSV document ending in a newline.
 */
export function toCsv(rows) {
  return `${rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')}\n`;
}
