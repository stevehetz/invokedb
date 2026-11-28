import {
    DEMO_HOURS,
    DEMO_MAX_LIVE,
    DEMO_PER_IP_PER_DAY,
    DemoIpLimiter,
    assert_not_demo,
    demo_busy_error,
    demo_email,
    demo_expires_at,
    demo_info,
    demo_ip_error,
    demo_max_live,
    expired_demo_ids,
    is_demo_account,
    is_demo_email
} from './demo';
import { DEMO_CAPS, DEMO_PLAN, PLANS, account_plan } from '../plan/plans';
import { ai_allowance } from '../ai/ai-plan';
import { session_usable } from '../session/session-rules';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 28, 12);

describe('demo accounts (#333)', () => {
    it('makes emails that are never a mailbox and fit the column', () => {
        const email = demo_email();
        expect(email).toMatch(/^demo-[0-9a-f]{16}@demo\.invalid$/);
        expect(email.length).toBeLessThanOrEqual(50);
        expect(demo_email()).not.toBe(email);
        expect(is_demo_email(email)).toBe(true);
        expect(is_demo_email(' X@Demo.Invalid ')).toBe(true);
        expect(is_demo_email('someone@example.com')).toBe(false);
        expect(is_demo_email('demo@invokedb.com')).toBe(false);
        expect(is_demo_email(null)).toBe(false);
    });

    it('knows a demo account by its expiry or its email', () => {
        expect(is_demo_account({ demo_expires_at: new Date(NOW) })).toBe(true);
        expect(is_demo_account({ email: demo_email(), demo_expires_at: null })).toBe(true);
        expect(is_demo_account({ email: 'demo@invokedb.com', demo_expires_at: null })).toBe(false);
        expect(is_demo_account(null)).toBe(false);
    });

    it('expires 24 hours after it is made', () => {
        expect(DEMO_HOURS).toBe(24);
        expect(demo_expires_at(NOW).getTime()).toBe(NOW + 24 * HOUR);
    });

    it('refuses the features that are off with 403 demo_account', () => {
        expect(() => assert_not_demo({ email: 'a@example.com' })).not.toThrow();
        try {
            assert_not_demo({ demo_expires_at: new Date(NOW) });
            throw new Error('not refused');
        } catch (ex) {
            expect(ex.getStatus()).toBe(403);
            expect(ex.getResponse()).toMatchObject({ code: 'demo_account' });
        }
    });

    it('answers its limits as 429 per IP and 503 when busy', () => {
        expect(demo_ip_error().getStatus()).toBe(429);
        expect(demo_ip_error().getResponse()).toMatchObject({ code: 'demo_limit' });
        expect(demo_busy_error().getStatus()).toBe(503);
        expect(demo_busy_error().getResponse()).toMatchObject({ code: 'demo_busy' });
    });

    it('reads the server-wide cap from the env, 50 by default', () => {
        expect(DEMO_MAX_LIVE).toBe(50);
        expect(demo_max_live(undefined)).toBe(50);
        expect(demo_max_live('')).toBe(50);
        expect(demo_max_live('4')).toBe(4);
        expect(demo_max_live('0')).toBe(0);
        expect(demo_max_live('-1')).toBe(50);
        expect(demo_max_live('2.5')).toBe(50);
        expect(demo_max_live('lots')).toBe(50);
    });

    it('lets one IP make 3 demos a day, counting only those made', () => {
        expect(DEMO_PER_IP_PER_DAY).toBe(3);
        const limiter = new DemoIpLimiter();
        // Asking doesn't count
        for (let i = 0; i < 10; i++) expect(limiter.allowed('1.2.3.4', NOW)).toBe(true);
        limiter.record('1.2.3.4', NOW);
        limiter.record('1.2.3.4', NOW + HOUR);
        expect(limiter.allowed('1.2.3.4', NOW + HOUR)).toBe(true);
        limiter.record('1.2.3.4', NOW + 2 * HOUR);
        expect(limiter.allowed('1.2.3.4', NOW + 2 * HOUR)).toBe(false);
        // Another IP has its own
        expect(limiter.allowed('5.6.7.8', NOW + 2 * HOUR)).toBe(true);
        // A day after the first, one is free again; a day after the last, all of them
        expect(limiter.allowed('1.2.3.4', NOW + 24 * HOUR - 1)).toBe(false);
        expect(limiter.allowed('1.2.3.4', NOW + 24 * HOUR)).toBe(true);
        expect(limiter.allowed('1.2.3.4', NOW + 26 * HOUR + 1)).toBe(true);
        expect(limiter.size).toBe(0);
    });

    it('sweeps expired demos only, soonest first', () => {
        const accounts = [
            { id: 3, demo_expires_at: new Date(NOW - HOUR) },
            { id: 1, demo_expires_at: new Date(NOW + HOUR) },
            { id: 2, demo_expires_at: new Date(NOW - 2 * HOUR).toISOString() },
            { id: 4, demo_expires_at: null },
            { id: 5, demo_expires_at: new Date(NOW) },
            { id: 'x', demo_expires_at: new Date(NOW - HOUR) },
            { id: 0, demo_expires_at: new Date(NOW - HOUR) }
        ];
        expect(expired_demo_ids(accounts, NOW)).toEqual([2, 3, 5]);
        expect(expired_demo_ids(accounts, NOW, 1)).toEqual([2]);
        expect(expired_demo_ids([], NOW)).toEqual([]);
    });

    it('tells the app when the demo ends, and nothing for other accounts', () => {
        expect(demo_info({ demo_expires_at: new Date(NOW) })).toEqual({
            expires_at: new Date(NOW).toISOString()
        });
        expect(demo_info({ email: 'a@example.com', demo_expires_at: null })).toBeNull();
    });

    it('puts demo accounts on their own small caps, whatever else they say', () => {
        const demo = {
            email: demo_email(),
            email_verified: true,
            subscription_id: 'SUB_LIVE_PLUS',
            internal: true,
            demo_expires_at: new Date(NOW)
        };
        const plan = account_plan(demo, {});
        expect(plan.plan).toBe(DEMO_PLAN);
        expect(plan.plan.name).toBe('Demo');
        expect(plan.internal).toBe(false);
        expect(plan.caps).toBe(DEMO_CAPS);
        expect(DEMO_CAPS.tables).toBe(10);
        expect(DEMO_CAPS.rows_per_account).toBe(2000);
        expect(DEMO_CAPS.webhooks).toBe(0);
        expect(DEMO_CAPS.url_sources).toBe(0);
        expect(DEMO_CAPS.api_calls_per_month).toBe(0);
        // Every cap a plan has, so nothing reads undefined
        expect(Object.keys(DEMO_CAPS).sort()).toEqual(Object.keys(PLANS.FREE.caps).sort());
    });

    it('gives demo accounts 3 AI questions and 20 AI rows', () => {
        const a = ai_allowance({ email_verified: true, demo_expires_at: new Date(NOW) });
        expect(a.questions).toBe(3);
        expect(a.rows).toBe(20);
        expect(a.verified).toBe(true);
        expect(a.budget_micros).toBeGreaterThan(0);
        // Others are as before
        expect(ai_allowance({ email_verified: true }).questions).toBe(PLANS.FREE.caps.ai.questions);
    });

    it("ends a demo's sessions when it expires", () => {
        const session = { expired_datetime: new Date(NOW + 30 * 24 * HOUR) };
        const live = { deleted: false, demo_expires_at: new Date(NOW + HOUR) };
        const over = { deleted: false, demo_expires_at: new Date(NOW - 1) };
        expect(session_usable(session, live, NOW)).toBe(true);
        expect(session_usable(session, over, NOW)).toBe(false);
        expect(session_usable(session, { deleted: false, demo_expires_at: null }, NOW)).toBe(true);
    });
});
