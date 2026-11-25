import env from '@app/env';
import { get_plan, get_plans, plan_for_subscription_status, usage_month } from './plans';

describe('plans', () => {
    const saved = { ...env };
    afterEach(() => Object.assign(env, saved));

    it('falls back to free for a missing or unknown plan', () => {
        expect(get_plan(null).id).toBe('free');
        expect(get_plan(undefined).id).toBe('free');
        expect(get_plan('SUB_TEST_PREMIUM').id).toBe('free');
        expect(get_plan('pro').id).toBe('pro');
        expect(get_plan('internal').id).toBe('internal');
    });

    it('gives every paid tier higher caps than free', () => {
        const { free, pro, internal } = get_plans();
        for (const key of Object.keys(free.limits)) {
            expect(pro.limits[key]).toBeGreaterThan(free.limits[key]);
            expect(internal.limits[key]).toBeGreaterThanOrEqual(pro.limits[key]);
        }
    });

    it('takes the free caps from the env when set', () => {
        env.HORIZON_FREE_MAX_TABLES = '2';
        env.HORIZON_FREE_MAX_ROWS = '5';
        env.HORIZON_FREE_MAX_API_CALLS = '0';
        expect(get_plan('free').limits).toEqual({
            max_tables: 2,
            max_rows: 5,
            max_api_calls_per_month: 0
        });
        env.HORIZON_FREE_MAX_TABLES = 'lots';
        env.HORIZON_FREE_MAX_ROWS = '-1';
        expect(get_plan('free').limits.max_tables).toBe(3);
        expect(get_plan('free').limits.max_rows).toBe(1000);
    });

    it('maps Stripe subscription statuses to a plan', () => {
        expect(plan_for_subscription_status('active')).toBe('pro');
        expect(plan_for_subscription_status('trialing')).toBe('pro');
        expect(plan_for_subscription_status('past_due')).toBe('pro');
        for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
            expect(plan_for_subscription_status(s)).toBe('free');
        }
        expect(plan_for_subscription_status(null)).toBe('free');
    });

    it('keys monthly usage by UTC month', () => {
        expect(usage_month(new Date('2026-11-30T23:59:59Z'))).toBe('2026-11');
        expect(usage_month(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
    });
});
