// Grid density (#361): Comfortable (the grid's usual sizes, the default) or Compact (smaller
// rows, header and padding). The choice is per device, kept in localStorage only (no account
// setting). It is `data-density="comfortable|compact"` on <html>, which stylesheet.scss's
// `[data-density='compact']` rules read, and the grid's ag-grid theme and sizes
// (h-data-grid/grid-theme.js), which follow on_density_change().

/** @typedef {'comfortable' | 'compact'} DensityChoice */

export const DENSITY_STORAGE_KEY = 'invokedb:density';
/** @type {DensityChoice[]} */
export const DENSITY_CHOICES = ['comfortable', 'compact'];

/** @type {Set<(choice: DensityChoice) => void>} */
const listeners = new Set();

/** @param {unknown} value @returns {DensityChoice} */
export function parse_density(value) {
    return value === 'compact' ? 'compact' : 'comfortable';
}

/** @returns {DensityChoice} */
function read_stored_density() {
    try {
        return parse_density(window.localStorage.getItem(DENSITY_STORAGE_KEY));
    } catch {
        return 'comfortable';
    }
}

/** @param {DensityChoice} choice */
function store_density(choice) {
    try {
        window.localStorage.setItem(DENSITY_STORAGE_KEY, choice);
    } catch {
        // Private mode or blocked storage: it lasts until the page is reloaded
    }
}

let current = read_stored_density();

/** Sets <html>'s data-density to the current choice. */
export function apply_density() {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.density = current;
}

/** @returns {DensityChoice} */
export function get_density() {
    return current;
}

/**
 * The account menu's choice: applied at once (open grids follow) and kept on this device.
 * @param {unknown} choice
 */
export function set_density(choice) {
    const next = parse_density(choice);
    store_density(next);
    if (next === current) return;
    current = next;
    apply_density();
    listeners.forEach(fn => fn(current));
}

/**
 * Calls `fn` with the new choice whenever it changes.
 * @param {(choice: DensityChoice) => void} fn
 * @returns {() => void} removes the listener
 */
export function on_density_change(fn) {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

apply_density();
