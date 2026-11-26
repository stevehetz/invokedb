import {
    AccountFacts,
    AdminInputError,
    DEFAULT_LOCK_REASON,
    LOCK_REASON_MAX,
    account_row,
    active_counts,
    cap_flags,
    delete_confirmed,
    e2e_result,
    is_admin,
    list_accounts,
    lock_reason,
    parse_account_query,
    parse_admin_emails,
    plan_change,
    plan_counts,
    signups_per_day
} from './admin';
import { PLANS, PLAN_SUBSCRIPTIONS, account_plan } from '../plan/plans';

const DAY = 24 * 60 * 60 * 1000;

function facts(over: Partial<AccountFacts> = {}): AccountFacts {
    return {
        id: 1,
        email: 'a@example.com',
        email_verified: true,
        subscription_id: null,
        internal: false,
        locked: false,
        locked_reason: null,
        created_at: null,
        last_active_at: null,
        two_factor: false,
        table_rows: [],
        storage_bytes: 0,
        api_calls: 0,
        ai_cost_micros: 0,
        ...over
    };
}

describe('parse_admin_emails', () => {
    it('lower-cases, trims and drops empty entries', () => {
        expect([...parse_admin_emails(' Owner@Example.com, ,b@x.io ')]).toEqual([
            'owner@example.com',
            'b@x.io'
        ]);
    });

    it('is empty (nobody) when unset or blank', () => {
        expect(parse_admin_emails(undefined).size).toBe(0);
        expect(parse_admin_emails('').size).toBe(0);
        expect(parse_admin_emails(' , ').size).toBe(0);
    });
});

describe('is_admin', () => {
    const emails = parse_admin_emails('owner@example.com');
    const owner = { email: 'Owner@Example.com', email_verified: true, deleted: false };

    it('needs the allowlist, a verified email and two-factor on', () => {
        expect(is_admin(owner, true, emails)).toBe(true);
        expect(is_admin(owner, false, emails)).toBe(false);
        expect(is_admin({ ...owner, email_verified: false }, true, emails)).toBe(false);
        expect(is_admin({ ...owner, email_verified: null }, true, emails)).toBe(false);
        expect(is_admin({ ...owner, email: 'other@example.com' }, true, emails)).toBe(false);
    });

    it('refuses a deleted account, no account and an empty allowlist', () => {
        expect(is_admin({ ...owner, deleted: true }, true, emails)).toBe(false);
        expect(is_admin(null, true, emails)).toBe(false);
        expect(is_admin(owner, true, parse_admin_emails(''))).toBe(false);
        expect(is_admin({ ...owner, email: '' }, true, parse_admin_emails(''))).toBe(false);
    });
});

describe('plan_change', () => {
    it('sets the subscription of a plan, and internal apart', () => {
        expect(plan_change('STARTER')).toEqual({
            subscription_id: PLAN_SUBSCRIPTIONS.STARTER,
            internal: false
        });
        expect(plan_change('FREE')).toEqual({ subscription_id: 'SUB_FREE', internal: false });
        expect(plan_change('INTERNAL')).toEqual({ internal: true });
    });

    it('refuses anything else', () => {
        for (const bad of ['free', 'ENTERPRISE', '', null, 3, {}]) {
            expect(() => plan_change(bad)).toThrow(AdminInputError);
        }
    });

    it('an internal account has no counted caps whatever its email', () => {
        const plan = account_plan({ email: 'x@example.com', internal: true });
        expect(plan.internal).toBe(true);
        expect(plan.caps.tables).toBe(Infinity);
        expect(account_plan({ email: 'x@example.com', internal: false }).internal).toBe(false);
    });
});

describe('lock_reason and delete_confirmed', () => {
    it('has a default reason and a length cap', () => {
        expect(lock_reason(undefined)).toBe(DEFAULT_LOCK_REASON);
        expect(lock_reason('  spam   sign-ups ')).toBe('spam sign-ups');
        expect(() => lock_reason('x'.repeat(LOCK_REASON_MAX + 1))).toThrow(AdminInputError);
    });

    it('needs the email typed again', () => {
        expect(delete_confirmed('a@example.com', ' A@example.com ')).toBe(true);
        expect(delete_confirmed('a@example.com', 'a@example.co')).toBe(false);
        expect(delete_confirmed('a@example.com', undefined)).toBe(false);
        expect(delete_confirmed('', '')).toBe(false);
    });
});

describe('cap_flags', () => {
    const caps = PLANS.FREE.caps;
    const use = {
        tables: 0,
        rows_per_account: 0,
        rows_per_table: 0,
        storage_bytes: 0,
        api_calls_per_month: 0
    };

    it('flags caps at or over as over, and from 80% as near', () => {
        const flags = cap_flags(
            { ...use, tables: 3, rows_per_table: 800, api_calls_per_month: 7999 },
            caps
        );
        expect(flags).toEqual([
            { limit: 'tables', used: 3, cap: 3, level: 'over' },
            { limit: 'rows_per_table', used: 800, cap: 1000, level: 'near' }
        ]);
    });

    it('flags nothing for an internal account', () => {
        const internal = account_plan({ email: 'x@example.com', internal: true }).caps;
        expect(cap_flags({ ...use, tables: 1000 }, internal)).toEqual([]);
    });
});

describe('account_row', () => {
    it('sums the rows, takes the fullest table and names the plan', () => {
        const row = account_row(
            facts({
                subscription_id: PLAN_SUBSCRIPTIONS.PRO,
                table_rows: [10, 30],
                ai_cost_micros: 1_234_567,
                locked: true,
                locked_reason: 'spam'
            })
        );
        expect(row).toMatchObject({
            plan: 'PRO',
            plan_name: 'Pro',
            tables: 2,
            rows: 40,
            ai_cost_usd: 1.234567,
            locked: true,
            locked_reason: 'spam',
            caps: []
        });
    });

    it('names an internal account after its plan', () => {
        expect(account_row(facts({ internal: true })).plan_name).toBe('Internal (Free)');
        expect(account_row(facts({ internal: true })).plan).toBe('INTERNAL');
    });
});

describe('parse_account_query', () => {
    it('has defaults', () => {
        expect(parse_account_query({})).toEqual({
            search: '',
            sort: 'created_at',
            dir: 'desc',
            page: 1,
            limit: 25,
            caps: 'all',
            plan: null
        });
    });

    it('refuses bad values', () => {
        for (const q of [
            { sort: 'password_hash' },
            { dir: 'up' },
            { page: '0' },
            { limit: '101' },
            { limit: '2.5' },
            { caps: 'some' },
            { plan: 'GOLD' },
            { search: 'x'.repeat(101) }
        ]) {
            expect(() => parse_account_query(q)).toThrow(AdminInputError);
        }
    });
});

describe('list_accounts', () => {
    const rows = [
        account_row(facts({ id: 1, email: 'ann@example.com', table_rows: [5], created_at: 3 })),
        account_row(facts({ id: 2, email: 'bob@test.io', table_rows: [999], created_at: null })),
        account_row(
            facts({ id: 3, email: 'cy@example.com', table_rows: [1, 1, 1], created_at: 1 })
        ),
        account_row(facts({ id: 4, email: 'di@example.com', internal: true, created_at: 2 }))
    ];
    const q = (over: any = {}) => parse_account_query(over);

    it('searches the email or the id', () => {
        expect(list_accounts(rows, q({ search: 'EXAMPLE' })).accounts.map(r => r.id)).toEqual([
            1, 4, 3
        ]);
        expect(list_accounts(rows, q({ search: '2' })).accounts.map(r => r.id)).toEqual([2]);
    });

    it('sorts either way with nulls last', () => {
        expect(list_accounts(rows, q()).accounts.map(r => r.id)).toEqual([1, 4, 3, 2]);
        expect(list_accounts(rows, q({ dir: 'asc' })).accounts.map(r => r.id)).toEqual([
            3, 4, 1, 2
        ]);
        expect(
            list_accounts(rows, q({ sort: 'email', dir: 'asc' })).accounts.map(r => r.id)
        ).toEqual([1, 2, 3, 4]);
    });

    it('filters on the caps and the plan', () => {
        // bob is near rows per table (999 of 1,000); cy is at the table cap (3 of 3)
        expect(list_accounts(rows, q({ caps: 'over' })).accounts.map(r => r.id)).toEqual([3]);
        expect(list_accounts(rows, q({ caps: 'near' })).accounts.map(r => r.id)).toEqual([2]);
        expect(
            list_accounts(rows, q({ caps: 'flagged', sort: 'email', dir: 'asc' })).accounts.map(
                r => r.id
            )
        ).toEqual([2, 3]);
        expect(list_accounts(rows, q({ plan: 'INTERNAL' })).accounts.map(r => r.id)).toEqual([4]);
    });

    it('pages', () => {
        const page = list_accounts(rows, q({ limit: '3', page: '2' }));
        expect(page).toMatchObject({ total: 4, page: 2, limit: 3 });
        expect(page.accounts.map(r => r.id)).toEqual([2]);
    });

    it('counts the plans', () => {
        expect(plan_counts(rows)).toEqual({ FREE: 3, STARTER: 0, PRO: 0, INTERNAL: 1 });
    });
});

describe('overview figures', () => {
    const now = Date.UTC(2026, 10, 26, 12);

    it('counts sign-ups per UTC day for the last 30 days, today included', () => {
        const days = signups_per_day(
            [now, now - 1000, now - DAY, now - 29 * DAY, now - 30 * DAY, null],
            now
        );
        expect(days).toHaveLength(30);
        expect(days[29]).toEqual({ day: '2026-11-26', count: 2 });
        expect(days[28]).toEqual({ day: '2026-11-25', count: 1 });
        expect(days[0]).toEqual({ day: '2026-10-28', count: 1 });
        expect(days.reduce((s, d) => s + d.count, 0)).toBe(4);
    });

    it('counts accounts active in 7 and 30 days', () => {
        expect(active_counts([now - DAY, now - 8 * DAY, now - 31 * DAY, null], now)).toEqual({
            days_7: 1,
            days_30: 2
        });
    });

    it('reads the latest E2E run, or says unknown', () => {
        expect(
            e2e_result({
                workflow_runs: [
                    {
                        conclusion: 'success',
                        updated_at: '2026-11-26T06:10:00Z',
                        html_url: 'https://github.com/stevehetz/invokedb/actions/runs/1'
                    }
                ]
            })
        ).toEqual({
            conclusion: 'success',
            at: Date.parse('2026-11-26T06:10:00Z'),
            url: 'https://github.com/stevehetz/invokedb/actions/runs/1'
        });
        expect(e2e_result({ workflow_runs: [] })).toEqual({
            conclusion: 'unknown',
            at: null,
            url: null
        });
        expect(e2e_result({ workflow_runs: [{ html_url: 'javascript:x' }] }).url).toBeNull();
    });
});
