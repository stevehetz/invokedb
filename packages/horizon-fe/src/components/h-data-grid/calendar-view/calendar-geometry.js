// The month grid of a calendar view (#211): six weeks from the Sunday on or before the 1st, in
// UTC like the stored dates. Pure, so the backend's range (`from` up to `to`) matches it.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {Date} d @returns {string} YYYY-MM-DD */
export function day_string(d) {
    return d.toISOString().slice(0, 10);
}

/** @param {number} year @param {number} month 0-11 @returns {string} */
export function month_title(year, month) {
    return `${MONTHS[month]} ${year}`;
}

/**
 * The days shown for a month: `{ date, day, in_month }` for 42 days, and the range to read
 * @param {number} year @param {number} month 0-11
 */
export function month_grid(year, month) {
    const first = new Date(Date.UTC(year, month, 1));
    const start = new Date(first.getTime() - first.getUTCDay() * DAY_MS);
    /** @type {{ date: string, day: number, in_month: boolean }[]} */
    const days = [];
    for (let i = 0; i < 42; i++) {
        const d = new Date(start.getTime() + i * DAY_MS);
        days.push({
            date: day_string(d),
            day: d.getUTCDate(),
            in_month: d.getUTCMonth() === month
        });
    }
    return {
        days,
        from: days[0].date,
        to: day_string(new Date(start.getTime() + 42 * DAY_MS))
    };
}

/**
 * The month before or after
 * @param {number} year @param {number} month 0-11 @param {number} step
 */
export function add_months(year, month, step) {
    const d = new Date(Date.UTC(year, month + step, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}
