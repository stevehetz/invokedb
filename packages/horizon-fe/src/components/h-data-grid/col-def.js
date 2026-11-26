// The grid's column objects are the backend's columns plus ag-grid options (#295).
// ag-grid only accepts its own options on a colDef, so the backend's fields travel
// in `colDef.context`: `to_grid` moves them there, `from_grid` brings them back.

/** The backend's column fields, which ag-grid doesn't know */
export const APP_KEYS = [
    '_id',
    'col_index',
    'col_type',
    'deleted',
    'file_directory_id',
    'indexed',
    'order',
    'link_table_id',
    'link_display_field'
];

/**
 * A flat column object as an ag-grid colDef
 * @param {Record<string, any>} def
 * @returns {Record<string, any>}
 */
export function to_grid(def) {
    const grid_def = { ...def };
    const context = { ...(def.context || {}) };
    APP_KEYS.forEach(k => {
        if (k in grid_def) {
            context[k] = grid_def[k];
            delete grid_def[k];
        }
    });
    // The backend pages columns like rows, so each one comes with a row number too
    delete grid_def.row_num;
    grid_def.context = context;
    return grid_def;
}

/**
 * An ag-grid colDef as a flat column object (a copy)
 * @param {Record<string, any>} grid_def
 * @returns {Record<string, any>}
 */
export function from_grid(grid_def) {
    const { context, ...rest } = grid_def || {};
    return { ...rest, ...(context || {}) };
}

/**
 * The backend's fields of an ag-grid colDef, for reading
 * @param {Record<string, any> | null | undefined} grid_def
 * @returns {Record<string, any>}
 */
export function col_meta(grid_def) {
    return (grid_def && grid_def.context) || {};
}
