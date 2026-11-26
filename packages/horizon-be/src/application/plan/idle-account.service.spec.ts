import { IdleAccountService } from './idle-account.service';
import { PLAN_SUBSCRIPTIONS } from '@app/core/plan/plans';
import { add_months } from '@app/core/plan/idle';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 15, 10);

// The accounts table, in memory: find/findOne/update as the service uses them
function make_repo(rows: any[]) {
    const pick = (a: any) => ({ ...a });
    return {
        rows,
        find: jest.fn(async ({ where }) =>
            rows.filter(r => where.deleted === undefined || r.deleted === where.deleted).map(pick)
        ),
        findOne: jest.fn(async ({ where }) => {
            const r = rows.find(x => x.id === where.id);
            return r ? pick(r) : null;
        }),
        update: jest.fn(async ({ id }, changes) => {
            const r = rows.find(x => x.id === id);
            if (r) Object.assign(r, changes);
        })
    };
}

const account = (id: number, extra: any = {}) => ({
    id,
    email: `user${id}@example.com`,
    email_verified: true,
    subscription_id: PLAN_SUBSCRIPTIONS.FREE,
    deleted: false,
    last_sign_in_at: new Date(T0),
    last_api_call_at: null,
    idle_clock_at: new Date(T0 - 30 * DAY),
    idle_warned_at: null,
    idle_final_warned_at: null,
    ...extra
});

function setup(rows: any[], configured = true) {
    const repo = make_repo(rows);
    const file_directory_repository = { countBy: jest.fn(async () => 2) };
    const email_manager = {
        is_configured: configured,
        send_text: jest.fn(async (_to: string, _subject: string, _text: string) => undefined)
    };
    const deletion = {
        delete_account: jest.fn(async (id: number) => {
            const i = repo.rows.findIndex(r => r.id === id);
            if (i >= 0) repo.rows.splice(i, 1);
        })
    };
    const service = new IdleAccountService(
        repo as any,
        file_directory_repository as any,
        email_manager as any,
        deletion as any
    );
    let now = T0;
    service.now = () => now;
    const at = (t: number) => (now = t);
    return { service, repo, email_manager, deletion, at };
}

describe('IdleAccountService (the idle job, with a fake clock)', () => {
    it('warns at 5 months, again a week before 6, deletes at 6; paid and active never', async () => {
        const rows = [
            account(1), // idle free: warned, warned, deleted
            account(2, { subscription_id: PLAN_SUBSCRIPTIONS.STARTER }), // paid
            account(3, { subscription_id: PLAN_SUBSCRIPTIONS.PRO }), // paid
            account(4, { email: 'demo@invokedb.com' }), // internal
            account(5) // free, but used again before its deletion
        ];
        const s = setup(rows);

        s.at(add_months(T0, 5) - DAY);
        expect(await s.service.run()).toEqual({ warned_first: [], warned_final: [], deleted: [] });

        s.at(add_months(T0, 5));
        expect(await s.service.run()).toEqual({
            warned_first: [1, 5],
            warned_final: [],
            deleted: []
        });
        expect(s.email_manager.send_text).toHaveBeenCalledTimes(2);
        expect(s.email_manager.send_text.mock.calls.map(c => c[0])).toEqual([
            'user1@example.com',
            'user5@example.com'
        ]);
        // Running again sends nothing more
        expect((await s.service.run()).warned_first).toEqual([]);

        // Account 5 signs in (SessionManager clears the warnings)
        Object.assign(
            rows.find(r => r.id === 5),
            {
                last_sign_in_at: new Date(add_months(T0, 5) + DAY),
                idle_warned_at: null
            }
        );

        s.at(add_months(T0, 6) - 7 * DAY);
        expect(await s.service.run()).toEqual({
            warned_first: [],
            warned_final: [1],
            deleted: []
        });

        s.at(add_months(T0, 6) - 1);
        expect((await s.service.run()).deleted).toEqual([]);

        s.at(add_months(T0, 6));
        expect((await s.service.run()).deleted).toEqual([1]);
        expect(s.deletion.delete_account).toHaveBeenCalledTimes(1);
        expect(s.deletion.delete_account).toHaveBeenCalledWith(1);

        // Much later: the paid and internal accounts are still there, never warned
        s.at(add_months(T0, 48));
        const later = await s.service.run();
        expect(later.deleted).toEqual([]);
        expect(rows.map(r => r.id).sort()).toEqual([2, 3, 4, 5]);
        for (const id of [2, 3, 4]) {
            expect(rows.find(r => r.id === id).idle_warned_at).toBeNull();
        }
        expect(s.email_manager.send_text.mock.calls.map(c => c[0])).not.toContain(
            'user2@example.com'
        );
    });

    it('reads an account again before deleting it, and spares one used since', async () => {
        const warned = account(1, {
            idle_warned_at: new Date(add_months(T0, 5)),
            idle_final_warned_at: new Date(add_months(T0, 6) - 7 * DAY)
        });
        const s = setup([warned]);
        s.at(add_months(T0, 6));
        // The list is read, then the account calls the API before its turn comes
        const find = s.repo.find.getMockImplementation();
        s.repo.find.mockImplementationOnce(async q => {
            const list = await find(q);
            s.repo.rows[0].last_api_call_at = new Date(add_months(T0, 6) - 1000);
            return list;
        });
        expect((await s.service.run()).deleted).toEqual([]);
        expect(s.deletion.delete_account).not.toHaveBeenCalled();
    });

    it('spares an account that turned paid before its deletion', async () => {
        const s = setup([
            account(1, {
                subscription_id: PLAN_SUBSCRIPTIONS.PRO,
                idle_warned_at: new Date(add_months(T0, 5)),
                idle_final_warned_at: new Date(add_months(T0, 6) - 7 * DAY)
            })
        ]);
        s.at(add_months(T0, 7));
        expect((await s.service.run()).deleted).toEqual([]);
        expect(s.deletion.delete_account).not.toHaveBeenCalled();
    });

    it("warns nobody, and so deletes nobody, when email can't be sent", async () => {
        const s = setup([account(1)], false);
        for (const months of [5, 6, 7, 12]) {
            s.at(add_months(T0, months));
            expect(await s.service.run()).toEqual({
                warned_first: [],
                warned_final: [],
                deleted: []
            });
        }
        expect(s.deletion.delete_account).not.toHaveBeenCalled();
    });

    it("doesn't record a warning whose email failed", async () => {
        const s = setup([account(1)]);
        s.email_manager.send_text.mockRejectedValueOnce(new Error('Mailgun responded 500'));
        s.at(add_months(T0, 5));
        expect((await s.service.run()).warned_first).toEqual([]);
        expect(s.repo.rows[0].idle_warned_at).toBeNull();
        expect((await s.service.run()).warned_first).toEqual([1]);
    });

    it('leaves deleted accounts alone', async () => {
        const s = setup([account(1, { deleted: true })]);
        s.at(add_months(T0, 24));
        expect(await s.service.run()).toEqual({ warned_first: [], warned_final: [], deleted: [] });
    });
});
