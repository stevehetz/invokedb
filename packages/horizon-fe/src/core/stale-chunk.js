// Stale chunks after a deploy (#372): route pages are lazy-loaded chunks with hashed names, and
// a deploy removes the old ones, so a tab opened before it fails to open a page it hasn't loaded
// yet. When a chunk fails to load, the page is reloaded once at the URL the user was going to,
// which fetches the new index.html and chunks. A reload is remembered in sessionStorage, and
// none is tried again within RELOAD_WINDOW_MS, so a chunk that still fails can't loop: its error
// goes through as before (and to the error tracker). While the reload is under way, nothing is
// reported (core/error-report.js asks `reloading_for_stale_chunk`).

export const RELOAD_KEY = 'invokedb:chunk-reload';
export const RELOAD_WINDOW_MS = 10_000;

// What browsers say when a dynamic import or its module script fails to load (Chrome, Firefox,
// Safari), and Vite's own preload failures (a chunk's CSS or imports)
const CHUNK_ERROR =
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Failed to load module script/i;

/** @param {any} err */
export function is_chunk_error(err) {
    const message = err && typeof err.message === 'string' ? err.message : '';
    return CHUNK_ERROR.test(message);
}

/**
 * Whether a reload may be tried now, given the time of the last one (or null).
 * @param {number | null} last
 * @param {number} now
 */
export function may_reload(last, now) {
    return !(last && now - last >= 0 && now - last < RELOAD_WINDOW_MS);
}

let reloading = false;

/** True once the page is being reloaded for a stale chunk: its errors aren't worth reporting. */
export function reloading_for_stale_chunk() {
    return reloading;
}

/** @returns {number | null} */
function last_reload() {
    try {
        const value = Number(sessionStorage.getItem(RELOAD_KEY));
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

/**
 * Reloads the page at `url`, unless it was reloaded for this too recently.
 * @param {string} url
 * @returns {boolean} whether the page is being reloaded
 */
function reload_once(url) {
    if (reloading) return true;
    const now = Date.now();
    if (!may_reload(last_reload(), now)) return false;
    try {
        sessionStorage.setItem(RELOAD_KEY, String(now));
    } catch {
        // Without sessionStorage there's no guard against a loop, so no reload either
        return false;
    }
    reloading = true;
    if (url === window.location.href) window.location.reload();
    else window.location.assign(url);
    return true;
}

/** @param {import('vue-router').Router} router */
export function install_stale_chunk_reload(router) {
    // The URL of the navigation under way, if any: a route's chunk loads before the URL changes
    /** @type {string | null} */
    let pending = null;
    /** @param {import('vue-router').RouteLocationNormalized} to */
    const href = to =>
        new URL(router.resolve(to).href, window.location.href).href;

    router.beforeEach(to => {
        pending = href(to);
    });
    router.afterEach(() => {
        pending = null;
    });

    // Vite's dynamic imports (a production build) report a failed chunk here first. Preventing
    // the default makes the import resolve to nothing instead of throwing, which is fine since
    // the page is going away.
    window.addEventListener('vite:preloadError', event => {
        if (reload_once(pending || window.location.href))
            event.preventDefault();
    });

    // Imports Vite didn't wrap (the dev server) fail in the navigation instead
    router.onError((err, to) => {
        pending = null;
        if (is_chunk_error(err)) reload_once(href(to));
    });
}
