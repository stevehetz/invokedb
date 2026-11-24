import { createTheme } from 'ag-grid-community';

// The grid's theme (ag-grid's Theming API). createTheme() is the core grid CSS with no theme
// parts, like the structural-only ag-grid.css the app used before ag-grid 33: stylesheet.scss
// (`.h-data-grid .ag-*`) still draws the grid. These params only turn off what the core CSS
// would draw on top of it (hover and selection overlays, borders, focus rings) and set the
// sizes the grid measures with.
export const grid_theme = createTheme().withParams({
    // stylesheet.scss draws the header row at 35px, the filter row and rows at 30px
    rowHeight: 30,
    headerHeight: 35,
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
    headerBackgroundColor: '#404040',
    headerTextColor: '#ffffff',

    // The focused cell's border (stylesheet.scss's .ag-cell-focus colour) and the editor,
    // which stylesheet.scss outlines itself
    rangeSelectionBorderColor: '#1fe0ff',
    cellEditingBorder: false,
    cellEditingShadow: false,
    focusShadow: false
});
