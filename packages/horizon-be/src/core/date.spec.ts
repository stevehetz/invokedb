import { parse_utc_date, format_date, iso_date_text, grid_date_text } from './date';

const iso = (value: unknown) => {
    const date = parse_utc_date(value);
    return isNaN(date.getTime()) ? 'invalid' : date.toISOString();
};

describe('parse_utc_date', () => {
    it('reads ISO dates without an offset as UTC', () => {
        expect(iso('2020-01-02')).toBe('2020-01-02T00:00:00.000Z');
        expect(iso('2020-01')).toBe('2020-01-01T00:00:00.000Z');
        expect(iso('2020-01-02 03:04:05')).toBe('2020-01-02T03:04:05.000Z');
        expect(iso('2020-01-02T03:04')).toBe('2020-01-02T03:04:00.000Z');
        expect(iso('2020-01-02T03:04:05.6789')).toBe('2020-01-02T03:04:05.678Z');
        expect(iso('  2020-01-02  ')).toBe('2020-01-02T00:00:00.000Z');
    });

    it('applies an ISO offset', () => {
        expect(iso('2020-01-02T03:04:05Z')).toBe('2020-01-02T03:04:05.000Z');
        expect(iso('2020-01-02T03:04:05+02:00')).toBe('2020-01-02T01:04:05.000Z');
        expect(iso('2020-01-02T03:04:05-0530')).toBe('2020-01-02T08:34:05.000Z');
    });

    it('reads the grid format', () => {
        expect(iso('2020-01-02 03:04:05 PM')).toBe('2020-01-02T15:04:05.000Z');
        expect(iso('2020-01-02 12:04:05 AM')).toBe('2020-01-02T00:04:05.000Z');
        expect(iso('2020-01-02 12:04:05 PM')).toBe('2020-01-02T12:04:05.000Z');
    });

    it('falls back to the JS parser, as UTC', () => {
        expect(iso('1/2/2020')).toBe('2020-01-02T00:00:00.000Z');
        expect(iso('Jan 2, 2020')).toBe('2020-01-02T00:00:00.000Z');
        expect(iso('Thu, 02 Jan 2020 03:04:05 GMT')).toBe('2020-01-02T03:04:05.000Z');
    });

    it('takes numbers and dates', () => {
        expect(iso(1577934245000)).toBe('2020-01-02T03:04:05.000Z');
        const date = new Date(1577934245123);
        const copy = parse_utc_date(date);
        expect(copy).not.toBe(date);
        expect(copy.getTime()).toBe(date.getTime());
    });

    it('gives an Invalid Date for bad input', () => {
        for (const value of ['2020-02-31', '2020-13-01', 'garbage', '', null, undefined, {}]) {
            expect(iso(value)).toBe('invalid');
        }
    });
});

describe('format_date', () => {
    const date = new Date('2020-01-02T15:04:05.678Z');

    it('formats in UTC', () => {
        expect(format_date(date, 'YYYY-MM-DD hh:mm:ss A', true)).toBe('2020-01-02 03:04:05 PM');
        expect(format_date(date, 'YYYY-MM-DD hh:mm:SS A', true)).toBe('2020-01-02 03:04:67 PM');
        expect(format_date(date, 'MM-DD-YYYY HH:mm', true)).toBe('01-02-2020 15:04');
        expect(format_date(new Date('2020-01-02T00:00:00Z'), 'hh A', true)).toBe('12 AM');
    });

    it('formats in local time', () => {
        const local = new Date(2020, 0, 2, 3, 4, 5);
        expect(format_date(local, 'YYYY-MM-DD HH:mm:ss')).toBe('2020-01-02 03:04:05');
    });

    it("gives 'Invalid date' for an invalid date", () => {
        expect(format_date(new Date(NaN), 'YYYY')).toBe('Invalid date');
    });
});

describe('iso_date_text', () => {
    it('gives ISO 8601 in UTC with milliseconds, keeping the seconds', () => {
        expect(iso_date_text(new Date('2026-11-28T12:01:29Z'))).toBe('2026-11-28T12:01:29.000Z');
        expect(iso_date_text('2026-11-28T12:01:29.123Z')).toBe('2026-11-28T12:01:29.123Z');
        expect(iso_date_text('2026-11-28T13:01:29.123+01:00')).toBe('2026-11-28T12:01:29.123Z');
        expect(iso_date_text('2024-01-15')).toBe('2024-01-15T00:00:00.000Z');
        // The old grid format is still read
        expect(iso_date_text('2020-01-02 03:04:05 PM')).toBe('2020-01-02T15:04:05.000Z');
    });

    it('gives null for what is not a date', () => {
        [null, undefined, '', 'soon', new Date(NaN), {}].forEach(v =>
            expect(iso_date_text(v)).toBeNull()
        );
    });
});

describe('grid_date_text', () => {
    it('shows a date as the grid does, in UTC', () => {
        expect(grid_date_text(new Date('2026-11-28T12:01:29.123Z'))).toBe('2026-11-28 12:01:29 PM');
        expect(grid_date_text('2024-01-15T00:00:00.000Z')).toBe('2024-01-15 12:00:00 AM');
    });

    it('leaves what is not a date as it is, and empty as null', () => {
        expect(grid_date_text('soon')).toBe('soon');
        [null, undefined, ''].forEach(v => expect(grid_date_text(v)).toBeNull());
    });
});
