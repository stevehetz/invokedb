import { HttpStatus } from '@nestjs/common';
import { PLANS } from './plans';
import {
    GRACE_DAYS,
    STOCK_CAPS,
    grace_end,
    grace_ended,
    next_plan_state,
    over_caps,
    parse_plan_state,
    plan_read_only_error
} from './plan-state';

const NOW = Date.UTC(2026, 10, 26, 12);
const DAY = 24 * 60 * 60 * 1000;

const under = () =>
    Object.fromEntries(STOCK_CAPS.map(k => [k, { used: 1, cap: 10 }])) as Record<
        string,
        { used: number; cap: number | null }
    >;

describe('plan state', () => {
    it('reads a stored state, and anything else as active', () => {
        expect(parse_plan_state('read_only')).toBe('read_only');
        expect(parse_plan_state('grace')).toBe('grace');
        expect(parse_plan_state('active')).toBe('active');
        expect(parse_plan_state(undefined)).toBe('active');
        expect(parse_plan_state('locked')).toBe('active');
    });

    it('finds the caps an account is over, and only those', () => {
        expect(over_caps(under())).toEqual([]);
        const u = under();
        u.tables = { used: 11, cap: 10 };
        u.storage_bytes = { used: 10, cap: 10 }; // at the cap is not over it
        u.rows_per_account = { used: 5000, cap: 3000 };
        expect(over_caps(u)).toEqual(['tables', 'rows_per_account']);
    });

    it('never counts a cap that is null (an internal account) or the API quota', () => {
        const u: any = under();
        u.tables = { used: 500, cap: null };
        u.api_calls_per_month = { used: 99999, cap: 5 };
        expect(over_caps(u)).toEqual([]);
    });

    it('is read-only while over the caps and active once under them', () => {
        expect(next_plan_state('active', null, ['tables'], NOW)).toBe('read_only');
        expect(next_plan_state('read_only', null, ['tables'], NOW)).toBe('read_only');
        expect(next_plan_state('read_only', null, [], NOW)).toBe('active');
        expect(next_plan_state('active', null, [], NOW)).toBe('active');
    });

    it('keeps full access during a grace period, over the caps or not', () => {
        const end = grace_end(NOW);
        expect(end.getTime()).toBe(NOW + GRACE_DAYS * DAY);
        expect(grace_ended('grace', end, NOW + 13 * DAY)).toBe(false);
        expect(next_plan_state('grace', end, ['rows_per_account'], NOW + 13 * DAY)).toBe('grace');
        expect(next_plan_state('grace', end, [], NOW)).toBe('grace');
    });

    it('ends a grace period on its date (and one with no date at once)', () => {
        const end = grace_end(NOW);
        expect(grace_ended('grace', end, NOW + GRACE_DAYS * DAY)).toBe(true);
        expect(grace_ended('grace', null, NOW)).toBe(true);
        expect(grace_ended('active', null, NOW)).toBe(false);
        expect(grace_ended('read_only', end, NOW + 100 * DAY)).toBe(false);
        // Then the state follows the caps (of Free, once the service has switched the plan)
        expect(next_plan_state('grace', end, ['tables'], NOW + GRACE_DAYS * DAY)).toBe('read_only');
        expect(next_plan_state('grace', end, [], NOW + GRACE_DAYS * DAY)).toBe('active');
    });

    it('refuses a write with 403 plan_read_only, the caps it is over and the upgrade link', () => {
        const err = plan_read_only_error(PLANS.FREE, ['tables', 'rows_per_account']);
        expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
        const body: any = err.getResponse();
        expect(body).toMatchObject({
            code: 'plan_read_only',
            over: ['tables', 'rows_per_account'],
            plan: 'FREE'
        });
        expect(body.upgrade_url).toMatch(/\/pricing$/);
        expect(body.message).toMatch(/read-only/);
        expect(body.message).toMatch(/tables, rows in all/);
    });
});
