// Row updates and AI columns (#205). The grid saves whole rows, so a grid that hasn't refreshed
// since the processor filled an AI cell sends that cell's old value back. Writing it would
// leave the cell's state (`<state_key>.<field>.h`) matching its inputs, and the cell would never
// be computed again. So an update that changes an AI cell drops that cell's state (the
// processor then computes it again), and it only lands while the stored AI cells are still
// what was read (a processor write in between means reading the row again).

function same_cell(a: unknown, b: unknown) {
    const x = a === undefined ? null : a;
    const y = b === undefined ? null : b;
    if (x instanceof Date || y instanceof Date) {
        const tx = x instanceof Date ? x.getTime() : x;
        const ty = y instanceof Date ? y.getTime() : y;
        return tx === ty;
    }
    if (Array.isArray(x) || Array.isArray(y)) return JSON.stringify(x) === JSON.stringify(y);
    return x === y;
}

/**
 * For an update `$set`ting `row` over `stored` (the row as read, with its AI state under
 * `state_key`): `unset`, the AI cells' states to drop because the update changes their value,
 * and `guard`, the filter that keeps the update from landing if the processor wrote one of the
 * row's AI cells meanwhile.
 */
export function ai_cell_update(stored: any, row: Record<string, unknown>, state_key: string) {
    const unset: string[] = [];
    const guard: Record<string, unknown> = {};
    const state = stored && stored[state_key];
    if (!state || typeof state !== 'object') return { unset, guard };
    Object.keys(state).forEach(field => {
        if (!Object.prototype.hasOwnProperty.call(row, field)) return;
        const before = stored[field] === undefined ? null : stored[field];
        guard[field] = before;
        if (!same_cell(before, row[field])) unset.push(`${state_key}.${field}`);
    });
    return { unset, guard };
}
