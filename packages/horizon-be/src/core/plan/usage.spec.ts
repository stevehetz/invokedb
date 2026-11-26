import { PLANS, PLAN_IDS, PLAN_SUBSCRIPTIONS, account_plan } from './plans';
import { build_usage } from './usage';

const NOW = Date.UTC(2026, 10, 25, 12);

const input = (plan = account_plan({ subscription_id: null }, {})) => ({
    plan,
    now: NOW,
    tables: [
        { id: 1, name: 'people', rows: 40, columns: 5, views: 2 },
        { id: 2, name: 'tasks', rows: 120, columns: 9, views: 0 }
    ],
    storage_bytes: 5000,
    api_calls: 77,
    url_sources: 1,
    webhooks: 0,
    forms: 1
});

describe.each(PLAN_IDS)('GET /usage on %s', plan_id => {
    const caps = PLANS[plan_id].caps;

    it("shows each counted cap against the account's use", () => {
        const plan = account_plan({ subscription_id: PLAN_SUBSCRIPTIONS[plan_id] }, {});
        const u = build_usage(input(plan));
        expect(u.plan).toEqual({ id: plan_id, name: PLANS[plan_id].name });
        expect(u.internal).toBe(false);
        expect(u.month).toBe('2026-11');
        expect(u.usage).toEqual({
            tables: { used: 2, cap: caps.tables },
            rows_per_account: { used: 160, cap: caps.rows_per_account },
            rows_per_table: { used: 120, cap: caps.rows_per_table },
            storage_bytes: { used: 5000, cap: caps.storage_bytes },
            columns_per_table: { used: 9, cap: caps.columns_per_table },
            api_calls_per_month: { used: 77, cap: caps.api_calls_per_month },
            url_sources: { used: 1, cap: caps.url_sources },
            webhooks: { used: 0, cap: caps.webhooks },
            forms: { used: 1, cap: caps.forms },
            views_per_table: { used: 2, cap: caps.views_per_table }
        });
        expect(u.tables).toHaveLength(2);
        expect(u.limits).toMatchObject({
            api_rate_per_second: caps.api_rate_per_second,
            query_page: caps.query_page,
            csv_upload_bytes: caps.csv_upload_bytes,
            audit_keep_days: caps.audit_keep_days,
            key_limits_and_logs: caps.key_limits_and_logs
        });
    });
});

describe('GET /usage', () => {
    it('has no caps for an internal account, and still counts', () => {
        const plan = account_plan({ email: 'demo@invokedb.com', email_verified: true }, {});
        const u = build_usage(input(plan));
        expect(u.internal).toBe(true);
        expect(u.usage.tables).toEqual({ used: 2, cap: null });
        expect(u.usage.api_calls_per_month).toEqual({ used: 77, cap: null });
        expect(u.limits.api_rate_per_second).toBeNull();
        expect(JSON.stringify(u)).not.toContain('Infinity');
    });

    it('counts 0 for an account with no tables', () => {
        const u = build_usage({ ...input(), tables: [] });
        expect(u.usage.rows_per_account.used).toBe(0);
        expect(u.usage.rows_per_table.used).toBe(0);
        expect(u.usage.columns_per_table.used).toBe(0);
    });
});
