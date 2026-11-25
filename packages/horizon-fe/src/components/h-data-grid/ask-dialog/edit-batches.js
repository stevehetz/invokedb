// Writing AI edits (#204) and cleanup fixes (#206) in requests the server takes: at most this
// many rows or about this many bytes each, under the server's body limit
const EDIT_BATCH_ROWS = 100;
const EDIT_BATCH_BYTES = 60000;

/**
 * Splits rows into requests the server takes.
 * @template T
 * @param {T[]} rows
 * @returns {T[][]}
 */
export function edit_batches(rows) {
    /** @type {T[][]} */
    const batches = [];
    /** @type {T[]} */
    let batch = [];
    let bytes = 0;
    rows.forEach(row => {
        const size = JSON.stringify(row).length;
        if (
            batch.length > 0 &&
            (batch.length >= EDIT_BATCH_ROWS || bytes + size > EDIT_BATCH_BYTES)
        ) {
            batches.push(batch);
            batch = [];
            bytes = 0;
        }
        batch.push(row);
        bytes += size;
    });
    if (batch.length > 0) batches.push(batch);
    return batches;
}

/** @param {number} n */
export function rows_text(n) {
    return `${n} row${n === 1 ? '' : 's'}`;
}

/** A cell as text: null as empty, anything else as it would print */
export function cell_text(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}
