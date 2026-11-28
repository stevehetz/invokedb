// Light and dark theme (#290). The app area uses the account's choice (System, Light or Dark,
// in the account menu); the public site always follows the device. The choice is saved on the
// account (PUT /account/theme, so it follows the user across devices) and in localStorage, which
// index.html's inline script reads to set the right theme before the first paint.
//
// The theme is two things on <html>: `data-theme="light|dark"` (the app's colour tokens,
// theme-tokens.scss) and the `dark` class (Element Plus's dark mode). Keep index.html's inline
// script in step with apply_theme().

import { http } from '@/core/http';

/** @typedef {'system' | 'light' | 'dark'} ThemeChoice */

export const THEME_STORAGE_KEY = 'invokedb:theme';
/** @type {ThemeChoice[]} */
export const THEME_CHOICES = ['system', 'light', 'dark'];

const media =
    typeof window !== 'undefined' && window.matchMedia
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

/**
 * `area`: 'app' uses the account's choice, 'site' the device's.
 * @type {{ choice: ThemeChoice, area: 'app' | 'site' }}
 */
const state = { choice: read_stored_choice(), area: 'site' };

/** @param {unknown} value @returns {ThemeChoice} */
export function parse_choice(value) {
    return THEME_CHOICES.includes(/** @type {ThemeChoice} */ (value))
        ? /** @type {ThemeChoice} */ (value)
        : 'system';
}

/** @returns {ThemeChoice} */
function read_stored_choice() {
    try {
        return parse_choice(window.localStorage.getItem(THEME_STORAGE_KEY));
    } catch {
        return 'system';
    }
}

/** @param {ThemeChoice} choice */
function store_choice(choice) {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    } catch {
        // Private mode or blocked storage: the account still has it
    }
}

/** @param {ThemeChoice} choice @returns {'light' | 'dark'} */
export function resolve_theme(choice) {
    if (choice === 'light' || choice === 'dark') return choice;
    return media && media.matches ? 'dark' : 'light';
}

/** Sets <html>'s theme for the current area and choice. */
function apply_theme() {
    const theme = resolve_theme(state.area === 'app' ? state.choice : 'system');
    const html = document.documentElement;
    html.dataset.theme = theme;
    html.classList.toggle('dark', theme === 'dark');
}

// System follows the device as it changes (an OS that switches at sunset)
if (media) {
    media.addEventListener('change', () => apply_theme());
}

/**
 * The router calls this on every navigation.
 * @param {'app' | 'site'} area
 */
export function set_theme_area(area) {
    state.area = area;
    apply_theme();
}

/** @returns {ThemeChoice} the account's choice as this page knows it */
export function get_theme_choice() {
    return state.choice;
}

/**
 * Applies the choice the account has (from GET /auth/authorize), when it loads. A choice made on
 * another device wins over this browser's stored one.
 * @param {unknown} account_theme
 */
export function sync_account_theme(account_theme) {
    if (account_theme === undefined || account_theme === null) return;
    const choice = parse_choice(account_theme);
    store_choice(choice);
    state.choice = choice;
    apply_theme();
}

/**
 * The account menu's choice: applied at once, then saved on the account.
 * @param {ThemeChoice} choice
 */
export async function choose_theme(choice) {
    state.choice = parse_choice(choice);
    store_choice(state.choice);
    apply_theme();
    await http.put(http.get_url('/account/theme'), { theme: state.choice });
}
