import { createTheme } from 'ag-grid-community';

// The grid's theme (ag-grid's Theming API). createTheme() is the core grid CSS with no theme
// parts, like the structural-only ag-grid.css the app used before ag-grid 33: stylesheet.scss
// (`.h-data-grid .ag-*`) still draws the grid. These params only turn off what the core CSS
// would draw on top of it (hover and selection overlays, borders, focus rings) and set the
// sizes the grid measures with.
//
// Density (#361, core/density.js): grid_theme is Comfortable, grid_theme_compact is Compact. Their
// sizes are GRID_SIZES, which the grid options use too (rowHeight, headerHeight,
// floatingFiltersHeight) and which must match stylesheet.scss.

/** @typedef {import('@/core/density').DensityChoice} DensityChoice */

/**
 * The sizes the grid measures with, per density.
 * @type {Record<DensityChoice, { row: number, header: number, filter: number }>}
 */
export const GRID_SIZES = {
    // stylesheet.scss draws the header row at 35px, the filter row and rows at 30px
    comfortable: { row: 30, header: 35, filter: 30 },
    // and under [data-density='compact'] the header row at 28px, the filter row and rows at 24px
    compact: { row: 24, header: 28, filter: 24 }
};

const base_theme = createTheme().withParams({
    listItemHeight: 24,

    fontFamily: 'inherit',
    borderRadius: 0,
    wrapperBorder: false,
    wrapperBorderRadius: 0,

    // stylesheet.scss draws the cell and header borders
    rowBorder: false,
    columnBorder: false,
    headerRowBorder: false,
    headerColumnBorder: false,

    // and the row colours (even, odd, selected, new); no hover colours
    rowHoverColor: 'transparent',
    selectedRowBackgroundColor: 'transparent',
    headerCellHoverBackgroundColor: 'transparent',
    headerCellMovingBackgroundColor: 'transparent',
    // The app's colour tokens (theme-tokens.scss), so the grid follows light and dark (#290)
    backgroundColor: 'var(--h-grid-row-even)',
    foregroundColor: 'var(--h-text)',
    headerBackgroundColor: 'var(--h-grid-header)',
    headerTextColor: 'var(--h-grid-header-text)',

    // The focused cell's border (stylesheet.scss's .ag-cell-focus colour) and the editor,
    // which stylesheet.scss outlines itself
    rangeSelectionBorderColor: 'var(--h-grid-focus)',
    cellEditingBorder: false,
    cellEditingShadow: false,
    focusShadow: false
    // No inputFocusShadow: it belongs to the input-style part, which this theme doesn't include
});

/** @param {DensityChoice} density */
function sized_theme(density) {
    const sizes = GRID_SIZES[density];
    return base_theme.withParams({
        rowHeight: sizes.row,
        headerHeight: sizes.header
    });
}

export const grid_theme = sized_theme('comfortable');
export const grid_theme_compact = sized_theme('compact');

/** @param {DensityChoice} density */
export function grid_theme_for(density) {
    return density === 'compact' ? grid_theme_compact : grid_theme;
}
