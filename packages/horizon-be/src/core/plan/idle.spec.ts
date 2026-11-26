import { PLAN_SUBSCRIPTIONS } from './plans';
import {
    IDLE_NOTICE_DAYS,
    IdleAccount,
    activity_stale,
    add_months,
    idle_decision,
    idle_rule_applies,
    idle_since,
    idle_warning_email
} from './idle';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 15, 10); // the last sign-in
const at = (t: number) => new Date(t);

// A free account last used at T0 (no test plans: `{}`)
const free = (extra: Partial<IdleAccount> = {}): IdleAccount => ({
    id: 1,
    email: 'someone@example.com',
    email_verified: true,
    subscription_id: PLAN_SUBSCRIPTIONS.FREE,
    deleted: false,
    last_sign_in_at: at(T0),
    last_api_call_at: null,
    idle_clock_at: at(T0 - 100 * DAY),
    idle_warned_at: null,
    idle_final_warned_at: null,
    ...extra
});
const decide = (a: IdleAccount, now: number) => idle_decision(a, now, {});

describe('add_months', () => {
    it('adds calendar months in UTC, clamped to the month end', () => {
        expect(add_months(Date.UTC(2026, 0, 15), 5)).toBe(Date.UTC(2026, 5, 15));
        expect(add_months(Date.UTC(2026, 0, 31), 1)).toBe(Date.UTC(2026, 1, 28));
        expect(add_months(Date.UTC(2026, 7, 31, 9), 6)).toBe(Date.UTC(2027, 1, 28, 9));
    });
});

describe('idle since', () => {
    it('is the latest of the sign-in, the API call and the idle clock', () => {
        expect(idle_since(free())).toBe(T0);
        expect(idle_since(free({ last_api_call_at: at(T0 + DAY) }))).toBe(T0 + DAY);
        expect(idle_since(free({ last_sign_in_at: null }))).toBe(T0 - 100 * DAY);
        expect(
            idle_since(free({ last_sign_in_at: null, idle_clock_at: null, last_api_call_at: null }))
        ).toBeNull();
    });
});

describe('who the idle rule applies to', () => {
    it('only free accounts that are not internal or deleted', () => {
        expect(idle_rule_applies(free(), {})).toBe(true);
        expect(idle_rule_applies(free({ subscription_id: null }), {})).toBe(true);
        expect(idle_rule_applies(free({ subscription_id: PLAN_SUBSCRIPTIONS.STARTER }), {})).toBe(
            false
        );
        expect(idle_rule_applies(free({ subscription_id: PLAN_SUBSCRIPTIONS.PRO }), {})).toBe(
            false
        );
        expect(idle_rule_applies(free({ email: 'demo@invokedb.com' }), {})).toBe(false);
        expect(idle_rule_applies(free({ deleted: true }), {})).toBe(false);
    });
});

describe('the idle job on one account, with a fake clock', () => {
    const first_due = add_months(T0, 5);
    const delete_due = add_months(T0, 6);

    it('does nothing before 5 months', () => {
        expect(decide(free(), T0 + DAY).action).toBe('none');
        expect(decide(free(), first_due - 1).action).toBe('none');
    });

    it('warns at 5 months, again a week before 6 months, then deletes at 6 months', () => {
        let a = free();
        const d1 = decide(a, first_due);
        expect(d1.action).toBe('warn_first');
        expect(d1.delete_at).toBe(delete_due);
        a = { ...a, idle_warned_at: at(first_due) };

        expect(decide(a, first_due + DAY).action).toBe('none');
        const final_due = delete_due - IDLE_NOTICE_DAYS * DAY;
        expect(decide(a, final_due - 1).action).toBe('none');
        const d2 = decide(a, final_due);
        expect(d2.action).toBe('warn_final');
        expect(d2.delete_at).toBe(delete_due);
        a = { ...a, idle_final_warned_at: at(final_due) };

        expect(decide(a, delete_due - 1).action).toBe('none');
        expect(decide(a, delete_due).action).toBe('delete');
    });

    it('never deletes without both warnings', () => {
        const long_after = add_months(T0, 30);
        expect(decide(free(), long_after).action).toBe('warn_first');
        const warned_once = free({ idle_warned_at: at(long_after) });
        expect(decide(warned_once, long_after + DAY).action).toBe('none');
        // A final warning with no first one doesn't count
        const only_final = free({ idle_final_warned_at: at(long_after) });
        expect(decide(only_final, long_after + 30 * DAY).action).toBe('warn_first');
    });

    it('gives each warning a week when the account was idle for longer already', () => {
        const late = add_months(T0, 12);
        const d1 = decide(free(), late);
        expect(d1.action).toBe('warn_first');
        expect(d1.delete_at).toBe(late + 14 * DAY);
        const a = free({ idle_warned_at: at(late) });
        expect(decide(a, late + 7 * DAY - 1).action).toBe('none');
        expect(decide(a, late + 7 * DAY).action).toBe('warn_final');
        const b = { ...a, idle_final_warned_at: at(late + 7 * DAY) };
        expect(decide(b, late + 14 * DAY - 1).action).toBe('none');
        expect(decide(b, late + 14 * DAY).action).toBe('delete');
    });

    it('starts over when the account is used: a sign-in or an API call voids the warnings', () => {
        const warned = free({
            idle_warned_at: at(first_due),
            idle_final_warned_at: at(delete_due - 7 * DAY)
        });
        const used = { ...warned, last_api_call_at: at(delete_due - DAY) };
        expect(decide(used, delete_due).action).toBe('none');
        expect(decide(used, add_months(delete_due - DAY, 5)).action).toBe('warn_first');
        const signed_in = { ...warned, last_sign_in_at: at(delete_due - 2 * DAY) };
        expect(decide(signed_in, delete_due + DAY).action).toBe('none');
    });

    it('counts from the idle clock (signup, or a lapse to Free) when it is the latest', () => {
        const lapsed = free({ idle_clock_at: at(T0 + 60 * DAY) });
        expect(decide(lapsed, first_due).action).toBe('none');
        expect(decide(lapsed, add_months(T0 + 60 * DAY, 5)).action).toBe('warn_first');
    });

    it('never touches a paid, internal or deleted account, however long idle', () => {
        const far = add_months(T0, 60);
        const warned = {
            idle_warned_at: at(T0 + 1),
            idle_final_warned_at: at(T0 + 2)
        };
        for (const a of [
            free({ subscription_id: PLAN_SUBSCRIPTIONS.STARTER, ...warned }),
            free({ subscription_id: PLAN_SUBSCRIPTIONS.PRO, ...warned }),
            free({ email: 'e2e@invokedb.com', ...warned }),
            free({ deleted: true, ...warned })
        ]) {
            expect(decide(a, far).action).toBe('none');
            expect(decide({ ...a, idle_warned_at: null, idle_final_warned_at: null }, far)).toEqual(
                { action: 'none', idle_since: null, delete_at: null }
            );
        }
    });

    it('does nothing when nothing tells it since when the account is idle', () => {
        const a = free({ last_sign_in_at: null, last_api_call_at: null, idle_clock_at: null });
        expect(decide(a, add_months(T0, 60)).action).toBe('none');
    });
});

describe('recording activity', () => {
    it('writes the last API call at most once an hour', () => {
        const hour = 60 * 60 * 1000;
        expect(activity_stale(null, T0, hour)).toBe(true);
        expect(activity_stale(at(T0 - hour + 1), T0, hour)).toBe(false);
        expect(activity_stale(at(T0 - hour), T0, hour)).toBe(true);
    });
});

describe('the warning emails', () => {
    it('say since when, until when and what would be lost', () => {
        const e = idle_warning_email({
            final: false,
            email: 'someone@example.com',
            idle_since: T0,
            delete_at: add_months(T0, 6),
            tables: 3,
            sign_in_url: 'https://invokedb.com/login'
        });
        expect(e.subject).toMatch(/deleted/);
        expect(e.text).toContain('someone@example.com');
        expect(e.text).toContain('January 15, 2026');
        expect(e.text).toContain('July 15, 2026');
        expect(e.text).toContain('its 3 tables');
        expect(e.text).toContain('https://invokedb.com/login');
        expect(e.text).toMatch(/remind you once more/);
        const f = idle_warning_email({
            final: true,
            email: 'someone@example.com',
            idle_since: T0,
            delete_at: add_months(T0, 6),
            tables: 1,
            sign_in_url: 'x'
        });
        expect(f.subject).toMatch(/in a week/);
        expect(f.text).toContain('its 1 table ');
        expect(f.text).toMatch(/last reminder/);
    });
});
