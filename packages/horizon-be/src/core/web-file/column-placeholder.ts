/**
 * `GET /web-file/:id/get_new_column` hands the grid a deleted placeholder column that the
 * grid's batch save switches on. A placeholder that was never switched on (cancelled, or a
 * repeated call) is still deleted with an empty name: column names can't be saved empty, and a
 * deleted real column keeps its name. Such a column is handed out again instead of inserting
 * another, so repeated calls don't grow the column collection (#236).
 */
export function is_unused_placeholder(col: any): boolean {
    if (!col || col.deleted !== true) return false;
    const name = col.headerName;
    return name === undefined || name === null || (typeof name === 'string' && name.trim() === '');
}

/**
 * The column ids the grid already holds as unsaved new columns (`?pending=<id>,<id>`), so the
 * same placeholder isn't handed out twice in one edit session. Anything that isn't a 24-hex id
 * is ignored.
 */
export function parse_pending_ids(raw: unknown): Set<string> {
    const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    const ids = new Set<string>();
    for (const part of parts) {
        if (typeof part !== 'string') continue;
        for (const id of part.split(',')) {
            const t = id.trim().toLowerCase();
            if (/^[0-9a-f]{24}$/.test(t)) ids.add(t);
        }
    }
    return ids;
}

/** The last column, when it's an unused placeholder the caller doesn't already hold. */
export function reusable_placeholder(last_col: any, pending: Set<string> = new Set()): any {
    if (!is_unused_placeholder(last_col)) return null;
    if (pending.has(String(last_col._id).toLowerCase())) return null;
    return last_col;
}
