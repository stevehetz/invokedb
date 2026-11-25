import {
    build_funnel,
    FUNNEL_STEPS,
    format_duration,
    format_funnel,
    median,
    parse_funnel_args
} from './onboarding-funnel';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.parse('2026-11-10T00:00:00Z');

const by_id = (funnel: ReturnType<typeof build_funnel>) =>
    Object.fromEntries(funnel.steps.map(s => [s.id, s]));

describe('median', () => {
    it('takes the middle value, or the mean of the two middle ones', () => {
        expect(median([])).toBeNull();
        expect(median([5])).toBe(5);
        expect(median([9, 1, 5])).toBe(5);
        expect(median([4, 1, 3, 2])).toBe(2.5);
    });
});

describe('build_funnel', () => {
    const states = [
        // Went all the way: called the API 2 hours after signing up
        {
            signed_up_at: T0,
            email_verified_at: T0 + 5 * MIN,
            table_created_at: T0 + 10 * MIN,
            key_viewed_at: T0 + 20 * MIN,
            command_copied_at: T0 + 30 * MIN,
            api_called_at: T0 + 2 * HOUR
        },
        // Called the API from their own code after 4 hours, never using the checklist
        {
            signed_up_at: T0 + DAY,
            email_verified_at: T0 + DAY + MIN,
            table_created_at: T0 + DAY + 2 * MIN,
            api_called_at: T0 + DAY + 4 * HOUR,
            dismissed_at: T0 + DAY + 3 * MIN
        },
        // Made a table, then stopped
        {
            signed_up_at: T0 + 2 * DAY,
            email_verified_at: T0 + 2 * DAY + MIN,
            table_created_at: T0 + 2 * DAY + 20 * MIN
        },
        // Never verified their email
        { signed_up_at: T0 + 3 * DAY },
        // An account from before #169: no signup time
        { key_viewed_at: T0, api_called_at: T0 + MIN },
        null
    ];

    it('counts the accounts that reach each step, in order', () => {
        const funnel = build_funnel(states);
        expect(funnel.accounts).toBe(4);
        expect(funnel.without_signup_time).toBe(1);
        expect(funnel.steps.map(s => s.id)).toEqual(FUNNEL_STEPS.map(s => s.id));
        expect(funnel.steps.map(s => s.accounts)).toEqual([4, 3, 3, 2, 2, 2]);
        expect(by_id(funnel).called_api.share).toBe(0.5);
        expect(by_id(funnel).signed_up.share).toBe(1);
        expect(funnel.dismissed).toBe(1);
    });

    it('counts a later step as having done the earlier ones', () => {
        // The key and command steps' times are missing when the call came another way
        const funnel = build_funnel([{ signed_up_at: T0, api_called_at: T0 + HOUR }]);
        expect(funnel.steps.every(s => s.accounts === 1)).toBe(true);
    });

    it('gives the median time from signup to each step, over the accounts that have one', () => {
        const funnel = build_funnel(states);
        // 2h and 4h
        expect(funnel.median_ms_to_first_call).toBe(3 * HOUR);
        expect(by_id(funnel).called_api.median_ms).toBe(3 * HOUR);
        // 10m, 2m, 20m
        expect(by_id(funnel).created_table.median_ms).toBe(10 * MIN);
        // Only the first account recorded viewing the key
        expect(by_id(funnel).viewed_api_key.median_ms).toBe(20 * MIN);
        expect(by_id(funnel).signed_up.median_ms).toBe(0);
    });

    it('leaves out times from before the signup time', () => {
        const funnel = build_funnel([{ signed_up_at: T0, api_called_at: T0 - DAY }]);
        expect(by_id(funnel).called_api.accounts).toBe(1);
        expect(funnel.median_ms_to_first_call).toBeNull();
    });

    it('only counts accounts that signed up in the period, until being exclusive', () => {
        const funnel = build_funnel(states, { since: T0 + DAY, until: T0 + 3 * DAY });
        expect(funnel.accounts).toBe(2);
        expect(funnel.since).toBe(T0 + DAY);
        expect(funnel.until).toBe(T0 + 3 * DAY);
        expect(by_id(funnel).called_api.accounts).toBe(1);
        expect(funnel.median_ms_to_first_call).toBe(4 * HOUR);
    });

    it('is empty, not NaN, with no accounts', () => {
        const funnel = build_funnel([]);
        expect(funnel.accounts).toBe(0);
        expect(funnel.steps.every(s => s.accounts === 0 && s.share === 0)).toBe(true);
        expect(funnel.median_ms_to_first_call).toBeNull();
    });

    it('ignores fields that are not times', () => {
        const funnel = build_funnel([
            { signed_up_at: 'yesterday' as any },
            { signed_up_at: T0, api_called_at: null as any }
        ]);
        expect(funnel.accounts).toBe(1);
        expect(funnel.without_signup_time).toBe(1);
        expect(by_id(funnel).called_api.accounts).toBe(0);
    });
});

describe('format_duration', () => {
    it('shows at most two units', () => {
        expect(format_duration(null)).toBe('-');
        expect(format_duration(0)).toBe('0s');
        expect(format_duration(45 * 1000)).toBe('45s');
        expect(format_duration(2 * HOUR + 5 * MIN + 7000)).toBe('2h 5m');
        expect(format_duration(3 * DAY + 4 * HOUR + 30 * MIN)).toBe('3d 4h');
        expect(format_duration(2 * DAY)).toBe('2d');
    });
});

describe('format_funnel', () => {
    it('prints each step, the median time to the first call and what was left out', () => {
        const text = format_funnel(
            build_funnel(
                [
                    { signed_up_at: T0, api_called_at: T0 + 2 * HOUR },
                    { signed_up_at: T0 + DAY },
                    {}
                ],
                { since: T0, until: T0 + 7 * DAY }
            )
        );
        expect(text).toContain('signed up 2026-11-10 to 2026-11-17');
        expect(text).toMatch(/^called_api\s+1\s+50%\s+2h$/m);
        expect(text).toMatch(/^signed_up\s+2\s+100%$/m);
        expect(text).toContain('Median time from signup to the first API call: 2h');
        expect(text).toContain('Left out: 1 older account(s)');
    });

    it('says "all time" without a period', () => {
        expect(format_funnel(build_funnel([]))).toContain('signed up all time');
    });
});

describe('parse_funnel_args', () => {
    it('reads dates as UTC days and --json', () => {
        expect(
            parse_funnel_args(['--since', '2026-11-01', '--until', '2026-12-01', '--json'])
        ).toEqual({
            since: Date.parse('2026-11-01T00:00:00Z'),
            until: Date.parse('2026-12-01T00:00:00Z'),
            json: true
        });
        expect(parse_funnel_args([])).toEqual({ json: false });
    });

    it('turns --days into a since', () => {
        expect(parse_funnel_args(['--days', '7'], T0)).toEqual({
            since: T0 - 7 * DAY,
            json: false
        });
    });

    it('refuses anything else', () => {
        expect(() => parse_funnel_args(['--since'])).toThrow(/--since/);
        expect(() => parse_funnel_args(['--since', '11/01/2026'])).toThrow(/--since/);
        expect(() => parse_funnel_args(['--until', '2026-13-45'])).toThrow(/--until/);
        expect(() => parse_funnel_args(['--days', '0'])).toThrow(/--days/);
        expect(() => parse_funnel_args(['--days', 'x'])).toThrow(/--days/);
        expect(() => parse_funnel_args(['--verbose'])).toThrow(/Unknown/);
    });
});
