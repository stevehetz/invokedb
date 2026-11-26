import { HttpException } from '@nestjs/common';
import { PlanStateService } from './plan-state.service';
import { TrackingManager, TABLE_LOCK_REASON } from '@app/core/tracking/tracking.manager';
import { PLAN_SUBSCRIPTIONS } from '@app/core/plan/plans';
import { STOCK_CAPS } from '@app/core/plan/plan-state';

// The real one pulls in modules Jest can't load (uuid is ESM-only); the tests hand in a fake
jest.mock('./usage.service', () => ({ UsageService: class {} }));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 12);

function make_repo(rows: any[]) {
    return {
        rows,
        updates: [] as any[],
        findOneBy: jest.fn(async ({ id }) => {
            const r = rows.find(x => x.id === id);
            return r ? { ...r } : null;
        }),
        find: jest.fn(async () => rows.filter(r => !r.deleted).map(r => ({ ...r }))),
        update: jest.fn(async function ({ id }, changes) {
            this.updates.push({ id, changes });
            const r = rows.find(x => x.id === id);
            if (r) Object.assign(r, changes);
        })
    };
}

const account = (extra: any = {}) => ({
    id: 1,
    email: 'user1@example.com',
    email_verified: true,
    subscription_id: PLAN_SUBSCRIPTIONS.FREE,
    deleted: false,
    locked: false,
    locked_reason: null,
    plan_state: 'active',
    grace_ends_at: null,
    ...extra
});

// What GET /usage answers: every stock cap under its cap, except those in `over`
const usage_with = (over: string[]) => ({
    usage: Object.fromEntries(
        STOCK_CAPS.map(k => [k, over.includes(k) ? { used: 11, cap: 10 } : { used: 1, cap: 10 }])
    )
});

function setup(rows: any[], over: string[] = []) {
    const repo = make_repo(rows);
    const state = { over };
    const usage_service = { usage: jest.fn(async () => usage_with(state.over)) };
    const file_directory_repository = { countBy: jest.fn(async () => 1) };
    const tracking = new TrackingManager({} as any, repo as any, file_directory_repository as any);
    const service = new PlanStateService(repo as any, usage_service as any, tracking);
    service.now = () => NOW;
    service.onModuleInit();
    return { service, repo, state, tracking, usage_service };
}

const outcome = (p: Promise<unknown>): Promise<any> =>
    p.then(
        () => 'ok',
        e => e
    );

describe('PlanStateService', () => {
    it('makes an account over its caps read-only, and active again once under them', async () => {
        const s = setup([account()], ['rows_per_account', 'tables']);
        expect(await s.service.refresh(1)).toEqual({
            state: 'read_only',
            over: ['tables', 'rows_per_account'],
            changed: true
        });
        expect(s.repo.rows[0].plan_state).toBe('read_only');
        s.state.over = [];
        expect((await s.service.refresh(1)).state).toBe('active');
        expect(s.repo.rows[0].plan_state).toBe('active');
    });

    it('only ever writes the plan state: never the locked flag', async () => {
        const s = setup([account({ locked: true, locked_reason: 'Other reason' })], ['tables']);
        await s.service.refresh(1);
        s.state.over = [];
        await s.service.refresh(1);
        for (const u of s.repo.updates) expect(Object.keys(u.changes)).toEqual(['plan_state']);
        expect(s.repo.rows[0]).toMatchObject({ locked: true, locked_reason: 'Other reason' });
    });

    it('keeps full access during a grace period, then puts the account on Free', async () => {
        const end = new Date(NOW + 3 * DAY);
        const s = setup(
            [
                account({
                    subscription_id: PLAN_SUBSCRIPTIONS.PRO,
                    plan_state: 'grace',
                    grace_ends_at: end
                })
            ],
            ['rows_per_account']
        );
        expect((await s.service.refresh(1)).state).toBe('grace');
        expect(s.repo.rows[0].subscription_id).toBe(PLAN_SUBSCRIPTIONS.PRO);

        s.service.now = () => NOW + 3 * DAY;
        expect((await s.service.refresh(1)).state).toBe('read_only');
        expect(s.repo.rows[0]).toMatchObject({
            subscription_id: PLAN_SUBSCRIPTIONS.FREE,
            plan_state: 'read_only',
            grace_ends_at: null
        });
        // The idle clock starts at the lapse
        expect(s.repo.rows[0].idle_clock_at).toEqual(new Date(NOW + 3 * DAY));
    });

    it('starts a 14-day grace period', async () => {
        const s = setup([account({ subscription_id: PLAN_SUBSCRIPTIONS.STARTER })]);
        expect(await s.service.start_grace(1)).toBe('grace');
        expect(s.repo.rows[0].grace_ends_at).toEqual(new Date(NOW + 14 * DAY));
    });

    it('leaves deleted and missing accounts alone', async () => {
        const s = setup([account({ deleted: true })], ['tables']);
        expect((await s.service.refresh(1)).state).toBe('active');
        expect((await s.service.refresh(99)).state).toBe('active');
        expect(s.repo.update).not.toHaveBeenCalled();
    });

    it('sweeps every account', async () => {
        const s = setup([account(), account({ id: 2, email: 'user2@example.com' })], ['forms']);
        await s.service.sweep();
        expect(s.repo.rows.map(r => r.plan_state)).toEqual(['read_only', 'read_only']);
    });

    it('has no test route without HORIZON_TEST_PLANS', async () => {
        const saved = process.env.HORIZON_TEST_PLANS;
        delete process.env.HORIZON_TEST_PLANS;
        try {
            const s = setup([account()]);
            const err = await outcome(s.service.set_test_plan(1, { plan: 'FREE' }));
            expect(err).toBeInstanceOf(HttpException);
            expect(err.getStatus()).toBe(404);
        } finally {
            if (saved !== undefined) process.env.HORIZON_TEST_PLANS = saved;
        }
    });
});

describe('TrackingManager with the read-only state', () => {
    const expect_read_only = (err: any, over: string[]) => {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(403);
        expect(err.getResponse()).toMatchObject({ code: 'plan_read_only', over });
    };

    it('refuses every write path of a read-only account while it is over its caps', async () => {
        const s = setup([account({ plan_state: 'read_only' })], ['rows_per_account']);
        const a = { ...s.repo.rows[0] };
        expect_read_only(await outcome(s.tracking.check_not_read_only(a)), ['rows_per_account']);
        expect_read_only(await outcome(s.tracking.add_table(a)), ['rows_per_account']);
        expect_read_only(
            await outcome(s.tracking.add_rows(a, { file_id: 7, rows_to_be_added: 1 })),
            ['rows_per_account']
        );
        expect_read_only(await outcome(s.tracking.add_columns(a, { file_id: 7, columns: [] })), [
            'rows_per_account'
        ]);
        expect_read_only(await outcome(s.tracking.create_columns(a, { file_id: 7, columns: [] })), [
            'rows_per_account'
        ]);
        expect_read_only(await outcome(s.tracking.validate_row_count(a, 1, 7)), [
            'rows_per_account'
        ]);
    });

    it('lets it write again as soon as it is under its caps', async () => {
        const s = setup([account({ plan_state: 'read_only' })], ['rows_per_account']);
        const a: any = { ...s.repo.rows[0] };
        expect_read_only(await outcome(s.tracking.check_not_read_only(a)), ['rows_per_account']);
        s.state.over = [];
        expect(await outcome(s.tracking.check_not_read_only(a))).toBe('ok');
        expect(a.plan_state).toBe('active');
        expect(s.repo.rows[0].plan_state).toBe('active');
    });

    it("doesn't look at an active account's usage", async () => {
        const s = setup([account()], ['tables']);
        expect(await outcome(s.tracking.check_not_read_only({ ...s.repo.rows[0] }))).toBe('ok');
        expect(s.usage_service.usage).not.toHaveBeenCalled();
    });

    it('keeps the read-only state and the locked flag apart', async () => {
        const s = setup([account({ plan_state: 'read_only' })], ['tables']);
        // Read-only, not locked: the lock check lets it through
        expect(await outcome(s.tracking.check_account_lock({ ...s.repo.rows[0] }))).toBe('ok');
        // Locked, not read-only: the read-only check lets it through
        const locked = { ...account({ locked: true, locked_reason: 'x' }) };
        expect(await outcome(s.tracking.check_not_read_only(locked))).toBe('ok');
        // Lifting the table lock leaves the plan state alone
        s.repo.rows[0].locked = true;
        s.repo.rows[0].locked_reason = TABLE_LOCK_REASON;
        await s.tracking.update_account_lock({ id: 1, email: 'user1@example.com' }, false);
        expect(s.repo.rows[0]).toMatchObject({ locked: false, plan_state: 'read_only' });
        for (const u of s.repo.updates) expect(Object.keys(u.changes)).not.toContain('plan_state');
    });

    it('records an API call at most once an hour, voiding the idle warnings', async () => {
        const s = setup([account({ idle_warned_at: new Date(NOW - DAY) })]);
        s.tracking.now = () => NOW;
        const a: any = { ...s.repo.rows[0], last_api_call_at: null };
        const record = (s.tracking as any).record_api_call.bind(s.tracking);
        await record(a);
        expect(s.repo.rows[0].last_api_call_at).toEqual(new Date(NOW));
        expect(s.repo.rows[0].idle_warned_at).toBeNull();
        s.tracking.now = () => NOW + 30 * 60 * 1000;
        await record(a);
        expect(s.repo.update).toHaveBeenCalledTimes(1);
        s.tracking.now = () => NOW + 60 * 60 * 1000;
        await record(a);
        expect(s.repo.update).toHaveBeenCalledTimes(2);
    });
});
