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
