/**
 * The app's colour theme (#290): `system` follows the device's light/dark setting. Saved on the
 * account so it follows the user across devices; the frontend also keeps it in localStorage so
 * the first paint is right before the account loads.
 */
export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'system';

/** The theme a request asks for, or null if it isn't one of THEMES. */
export function parse_theme(value: unknown): Theme | null {
    return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
        ? (value as Theme)
        : null;
}

/** What an account's stored value means: anything unknown (or missing) is the default. */
export function account_theme(value: unknown): Theme {
    return parse_theme(value) ?? DEFAULT_THEME;
}
