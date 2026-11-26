import { HttpStatus } from '@nestjs/common';
import {
    COUNTED_CAPS,
    INTERNAL_EMAILS,
    MAX_COLUMNS,
    PLANS,
    PLAN_IDS,
    PLAN_SUBSCRIPTIONS,
    PlanCaps,
    PlanId,
    SERVER_MAX_UPLOAD_BYTES,
    account_plan,
    assert_room,
    assert_sync_schedule,
    parse_test_plans,
    plan_id_of,
    plan_limit_body,
    plan_limit_error,
    public_plans,
    quota_month,
    seconds_to_next_month,
    usage_item
} from './plans';

const MB = 1024 * 1024;
const GB = 1024 * MB;

// docs/PRICING.md 3.2 and 3.5, as decided on 2026-11-25
const DECIDED: Record<PlanId, PlanCaps & { price: number | null }> = {
    FREE: {
        price: null,
        tables: 3,
        rows_per_account: 3000,
        rows_per_table: 1000,
        storage_bytes: 10 * MB,
        columns_per_table: 20,
        api_calls_per_month: 10000,
        api_rate_per_second: 2,
        api_rate_burst: 10,
        rows_per_write: 100,
        query_page: 100,
        csv_upload_bytes: 1 * MB,
        url_sources: 1,
        url_sync_schedules: ['off', 'daily'],
        webhooks: 1,
        forms: 1,
        views_per_table: 5,
        audit_keep_days: 7,
        key_limits_and_logs: false,
        ai: { questions: 10, rows: 50, budget_usd: 0.05 }
    },
    STARTER: {
        price: 9,
        tables: 25,
        rows_per_account: 100000,
        rows_per_table: 100000,
        storage_bytes: 1 * GB,
        columns_per_table: 52,
        api_calls_per_month: 250000,
        api_rate_per_second: 10,
        api_rate_burst: 50,
        rows_per_write: 100,
        query_page: 1000,
        csv_upload_bytes: 25 * MB,
        url_sources: 5,
        url_sync_schedules: ['off', 'hourly', 'daily'],
        webhooks: 5,
        forms: 10,
        views_per_table: 50,
        audit_keep_days: 30,
        key_limits_and_logs: true,
        ai: { questions: 300, rows: 1000, budget_usd: 1 }
    },
    PRO: {
        price: 29,
        tables: 100,
        rows_per_account: 1000000,
        rows_per_table: 1000000,
        storage_bytes: 5 * GB,
        columns_per_table: 52,
        api_calls_per_month: 2000000,
        api_rate_per_second: 25,
        api_rate_burst: 100,
        rows_per_write: 100,
        query_page: 1000,
        csv_upload_bytes: 100 * MB,
        url_sources: 25,
        url_sync_schedules: ['off', 'hourly', 'daily'],
        webhooks: 10,
        forms: 50,
        views_per_table: 50,
        audit_keep_days: 90,
        key_limits_and_logs: true,
        ai: { questions: 2000, rows: 10000, budget_usd: 5 }
    }
};

const on_plan = (plan_id: PlanId) => ({
    email: 'someone@example.com',
    email_verified: true,
    subscription_id: PLAN_SUBSCRIPTIONS[plan_id]
});

describe.each(PLAN_IDS)('plan %s', plan_id => {
    const plan = PLANS[plan_id];
    const { price, ...decided } = DECIDED[plan_id];

    it('has the caps decided in docs/PRICING.md 3.2', () => {
        expect(plan.caps).toEqual(decided);
        expect(plan.price_month_usd).toBe(price);
        expect(plan.price_year_usd).toBe(price === null ? null : price * 10);
    });

    it('has every counted cap as a positive whole number', () => {
        COUNTED_CAPS.forEach(k => {
            expect(Number.isInteger(plan.caps[k])).toBe(true);
            expect(plan.caps[k]).toBeGreaterThan(0);
        });
    });

    it('stays within what the server takes', () => {
        expect(plan.caps.columns_per_table).toBeLessThanOrEqual(MAX_COLUMNS);
        expect(plan.caps.csv_upload_bytes).toBeLessThanOrEqual(SERVER_MAX_UPLOAD_BYTES);
        expect(plan.caps.rows_per_table).toBeLessThanOrEqual(plan.caps.rows_per_account);
        expect(plan.caps.url_sync_schedules).toContain('off');
    });

    it('is what an account on it gets', () => {
        expect(account_plan(on_plan(plan_id))).toEqual({
            plan,
            internal: false,
            caps: plan.caps
        });
    });

    it.each(['webhooks', 'forms', 'url_sources', 'views_per_table'] as const)(
        'allows %s up to the cap and refuses one more with plan_limit',
        limit => {
            const cap = plan.caps[limit];
            expect(() => assert_room(on_plan(plan_id), limit, cap - 1)).not.toThrow();
            let err: any;
            try {
                assert_room(on_plan(plan_id), limit, cap);
            } catch (e) {
                err = e;
            }
            expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
            expect(err.getResponse()).toMatchObject({
                code: 'plan_limit',
                limit,
                cap,
                plan: plan_id
            });
        }
    );

    it('allows only its sync schedules', () => {
        ['off', 'hourly', 'daily'].forEach(schedule => {
            const allowed = plan.caps.url_sync_schedules.includes(schedule as any);
            const run = () => assert_sync_schedule(on_plan(plan_id), schedule);
            if (allowed) expect(run).not.toThrow();
            else expect(run).toThrow();
        });
    });
});

describe('plans', () => {
    it('go up from Free to Pro', () => {
        COUNTED_CAPS.forEach(k => {
            expect(PLANS.FREE.caps[k]).toBeLessThanOrEqual(PLANS.STARTER.caps[k]);
            expect(PLANS.STARTER.caps[k]).toBeLessThanOrEqual(PLANS.PRO.caps[k]);
        });
    });

    it("map today's subscription ids", () => {
        expect(plan_id_of(null)).toBe('FREE');
        expect(plan_id_of('SUB_FREE')).toBe('FREE');
        expect(plan_id_of('SUB_TEST_BASIC')).toBe('STARTER');
        expect(plan_id_of('SUB_LIVE_BASIC')).toBe('STARTER');
        expect(plan_id_of('SUB_LIVE_PLUS')).toBe('PRO');
        expect(plan_id_of('SUB_TEST_PREMIUM')).toBe('PRO');
        expect(plan_id_of('SUB_SOMETHING_ELSE')).toBe('FREE');
    });

    it('are served whole, with no Infinity', () => {
        const json = JSON.parse(JSON.stringify(public_plans()));
        expect(json.map(p => p.id)).toEqual(['FREE', 'STARTER', 'PRO']);
        expect(json[0].caps).toEqual(PLANS.FREE.caps);
    });
});

describe('internal accounts', () => {
    it('have no counted caps, and keep Pro’s sizes and features', () => {
        INTERNAL_EMAILS.forEach(email => {
            const p = account_plan({ email, email_verified: true, subscription_id: null }, {});
            expect(p.internal).toBe(true);
            COUNTED_CAPS.forEach(k => expect(p.caps[k]).toBe(Infinity));
            expect(p.caps.api_rate_per_second).toBe(Infinity);
            expect(p.caps.columns_per_table).toBe(PLANS.PRO.caps.columns_per_table);
            expect(p.caps.query_page).toBe(PLANS.PRO.caps.query_page);
            expect(p.caps.key_limits_and_logs).toBe(true);
        });
    });

    it('need a verified email', () => {
        const p = account_plan(
            { email: 'demo@invokedb.com', email_verified: false, subscription_id: null },
            {}
        );
        expect(p.internal).toBe(false);
        expect(p.caps).toEqual(PLANS.FREE.caps);
    });

    it('match the email whatever its case', () => {
        const p = account_plan({ email: 'Demo@InvokeDB.com', email_verified: true }, {});
        expect(p.internal).toBe(true);
    });
});

describe('test plans (HORIZON_TEST_PLANS)', () => {
    it('put an account on a plan with shrunken caps, and it is not internal', () => {
        const overrides = parse_test_plans(
            JSON.stringify({
                'demo7@invokedb.com': { plan: 'FREE', caps: { tables: 2, nope: 9 } },
                'demo5@invokedb.com': { plan: 'STARTER' }
            })
        );
        const p = account_plan({ email: 'demo7@invokedb.com', email_verified: true }, overrides);
        expect(p.internal).toBe(false);
        expect(p.plan.id).toBe('FREE');
        expect(p.caps).toEqual({ ...PLANS.FREE.caps, tables: 2 });
        const s = account_plan({ email: 'DEMO5@invokedb.com', email_verified: true }, overrides);
        expect(s.plan.id).toBe('STARTER');
        expect(s.caps).toEqual(PLANS.STARTER.caps);
    });

    it('leave out what is not valid', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(parse_test_plans(undefined)).toEqual({});
        expect(parse_test_plans('not json')).toEqual({});
        expect(parse_test_plans('[1]')).toEqual({});
        expect(parse_test_plans('{"a@b.c": {"plan": "GOLD"}}')).toEqual({});
        spy.mockRestore();
    });
});

describe('refusals', () => {
    it('say which limit, the cap, the plan and where to upgrade', () => {
        expect(plan_limit_body('tables', 3, PLANS.FREE)).toEqual({
            message: 'Your plan (Free) allows 3 tables. Upgrade for more.',
            code: 'plan_limit',
            limit: 'tables',
            cap: 3,
            plan: 'FREE',
            upgrade_url: expect.stringMatching(/\/pricing$/)
        });
        expect(plan_limit_body('storage_bytes', 10 * MB, PLANS.FREE).message).toBe(
            'Your plan (Free) allows 10 MB of storage. Upgrade for more.'
        );
        expect(plan_limit_body('url_sync_schedules', ['off', 'daily'], PLANS.FREE).message).toBe(
            'Your plan (Free) allows URL syncs daily only. Upgrade for more.'
        );
    });

    it('are 403 unless told otherwise', () => {
        expect(plan_limit_error('forms', 1, PLANS.FREE).getStatus()).toBe(403);
        expect(plan_limit_error('api_calls_per_month', 1, PLANS.FREE, 429).getStatus()).toBe(429);
    });
});

describe('the monthly API quota', () => {
    it('is per UTC calendar month', () => {
        expect(quota_month(Date.UTC(2026, 10, 30, 23, 59, 59))).toBe('2026-11');
        expect(quota_month(Date.UTC(2026, 11, 1))).toBe('2026-12');
    });

    it('resets on the 1st (UTC)', () => {
        expect(seconds_to_next_month(Date.UTC(2026, 10, 30, 23, 59, 0))).toBe(60);
        expect(seconds_to_next_month(Date.UTC(2026, 11, 31, 0, 0, 0))).toBe(24 * 3600);
        expect(seconds_to_next_month(Date.UTC(2026, 11, 1) - 1)).toBe(1);
    });
});

describe('usage_item', () => {
    it('sends no cap as null', () => {
        expect(usage_item(5, 10)).toEqual({ used: 5, cap: 10 });
        expect(usage_item(5, Infinity)).toEqual({ used: 5, cap: null });
    });
});
