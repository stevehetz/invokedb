// The grid's column objects are the backend's columns plus ag-grid options (#295).
// ag-grid only accepts its own options on a colDef, so the backend's fields travel
// in `colDef.context`: `to_grid` moves them there, `from_grid` brings them back.

import { grid_date_text, parse_grid_date } from '@/core/date';

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

/** @param {{ value: unknown }} params */
const date_cell_text = params => grid_date_text(params.value);

/** @param {{ newValue: unknown, oldValue: unknown }} params */
const date_cell_value = params =>
    parse_grid_date(params.newValue, params.oldValue);

const DATE_EDITOR_PARAMS = Object.freeze({ useFormatter: true });

/**
 * The API answers dates as ISO 8601 (#356): a date column shows them readably, its editor
 * starts from that text, and what's typed is saved as ISO 8601. Other columns go without.
 * @param {Record<string, any>} grid_def
 */
function set_date_options(grid_def) {
    if (grid_def.col_type === 'date') {
        grid_def.valueFormatter = date_cell_text;
        grid_def.valueParser = date_cell_value;
        grid_def.cellEditorParams = DATE_EDITOR_PARAMS;
        return;
    }
    if (grid_def.valueFormatter === date_cell_text)
        delete grid_def.valueFormatter;
    if (grid_def.valueParser === date_cell_value) delete grid_def.valueParser;
    if (grid_def.cellEditorParams === DATE_EDITOR_PARAMS) {
        delete grid_def.cellEditorParams;
    }
}

/**
 * A flat column object as an ag-grid colDef
 * @param {Record<string, any>} def
 * @returns {Record<string, any>}
 */
export function to_grid(def) {
    const grid_def = { ...def };
    set_date_options(grid_def);
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
