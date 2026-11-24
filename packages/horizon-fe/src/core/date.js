// Small date helpers that replace `moment`. A copy of the backend's src/core/date.ts, whose
// date.spec.ts tests them.

// ISO 8601 date or date-time (`2020-01-02`, `2020-01-02T03:04:05.678Z`, `2020-01-02 03:04+02:00`)
const ISO_DATE =
    /^(\d{4})-(\d{2})(?:-(\d{2})(?:[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?)?)?$/i;
// The format the grid shows and filters with: `2020-01-02 03:04:05 PM`
const GRID_DATE =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i;

const invalid_date = () => new Date(NaN);

const utc_date = (
    y,
    mo,
    d = 1,
    h = 0,
    mi = 0,
    s = 0,
    ms = 0,
    offset_min = 0
) => {
    if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) {
        return invalid_date();
    }
    const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
    date.setUTCFullYear(y); // Date.UTC maps years 0-99 to 1900-1999
    if (date.getUTCDate() !== d) {
        return invalid_date(); // e.g. 2020-02-31
    }
    return new Date(date.getTime() - offset_min * 60000);
};

/** @param {string} offset */
const offset_minutes = offset => {
    if (!offset || offset.toUpperCase() === 'Z') return 0;
    const sign = offset[0] === '-' ? -1 : 1;
    const digits = offset.slice(1).replace(':', '');
    return (
        sign *
        (parseInt(digits.slice(0, 2), 10) * 60 +
            parseInt(digits.slice(2) || '0', 10))
    );
};

/**
 * Parses a date the way `moment.utc(value)` did: ISO strings without an offset
 * are UTC, other strings fall back to the JS parser (as UTC when they don't
 * name a zone), numbers are epoch milliseconds. Returns an Invalid Date (never
 * throws) when the value can't be parsed.
 * @param {unknown} value
 * @returns {Date}
 */
export function parse_utc_date(value) {
    if (value instanceof Date) return new Date(value.getTime());
    if (typeof value === 'number') return new Date(value);
    if (typeof value !== 'string') return invalid_date();

    const str = value.trim();
    const iso = ISO_DATE.exec(str);
    if (iso) {
        /** @param {number} i */
        const n = i =>
            iso[i] === undefined ? undefined : parseInt(iso[i], 10);
        const ms =
            iso[7] === undefined ? 0 : Math.floor(Number(`0.${iso[7]}`) * 1000);
        return utc_date(
            n(1),
            n(2),
            n(3),
            n(4),
            n(5),
            n(6),
            ms,
            offset_minutes(iso[8])
        );
    }
    const grid = GRID_DATE.exec(str);
    if (grid) {
        /** @param {number} i */
        const n = i =>
            grid[i] === undefined ? undefined : parseInt(grid[i], 10);
        const h12 = n(4);
        if (h12 < 1 || h12 > 12) return invalid_date();
        const h = (h12 % 12) + (grid[7].toUpperCase() === 'PM' ? 12 : 0);
        return utc_date(n(1), n(2), n(3), h, n(5), n(6));
    }
    if (!str) return invalid_date();
    const as_utc = new Date(`${str} UTC`);
    return isNaN(as_utc.getTime()) ? new Date(str) : as_utc;
}

const pad = (n, length = 2) => String(n).padStart(length, '0');

/**
 * Formats a date with moment-style tokens: YYYY MM DD HH hh mm ss SS
 * (hundredths of a second) and A (AM/PM). Uses UTC when `utc` is set, local
 * time otherwise. Gives 'Invalid date' (as moment did) for an invalid date.
 * @param {Date} date
 * @param {string} pattern
 * @param {boolean} [utc]
 * @returns {string}
 */
export function format_date(date, pattern, utc = false) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return 'Invalid date';
    const parts = utc
        ? {
              y: date.getUTCFullYear(),
              mo: date.getUTCMonth() + 1,
              d: date.getUTCDate(),
              h: date.getUTCHours(),
              mi: date.getUTCMinutes(),
              s: date.getUTCSeconds(),
              ms: date.getUTCMilliseconds()
          }
        : {
              y: date.getFullYear(),
              mo: date.getMonth() + 1,
              d: date.getDate(),
              h: date.getHours(),
              mi: date.getMinutes(),
              s: date.getSeconds(),
              ms: date.getMilliseconds()
          };
    const tokens = {
        YYYY: () => pad(parts.y, 4),
        MM: () => pad(parts.mo),
        DD: () => pad(parts.d),
        HH: () => pad(parts.h),
        hh: () => pad(parts.h % 12 || 12),
        mm: () => pad(parts.mi),
        ss: () => pad(parts.s),
        SS: () => pad(Math.floor(parts.ms / 10)),
        A: () => (parts.h < 12 ? 'AM' : 'PM')
    };
    return pattern.replace(/YYYY|MM|DD|HH|hh|mm|ss|SS|A/g, token =>
        tokens[token]()
    );
}
