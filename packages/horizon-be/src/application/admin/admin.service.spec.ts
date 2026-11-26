import { HttpException } from '@nestjs/common';
import { Account } from '@app/core/account/account.entity';
import { PLAN_SUBSCRIPTIONS } from '@app/core/plan/plans';
import { AdminService } from './admin.service';

jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../plan/usage.service', () => ({}));
jest.mock('../auth/auth.service', () => ({}));

function account(over: Partial<Account> = {}) {
    const a = new Account();
    Object.assign(a, {
        id: 2,
        email: 'customer@example.com',
        email_verified: false,
        deleted: false,
        locked: false,
        locked_reason: null,
        subscription_id: null,
        internal: false,
        ...over
    });
    return a;
}

const admin = account({ id: 1, email: 'owner@example.com', email_verified: true });

function setup(target: Account | null = account()) {
    const accounts = new Map<number, Account>();
    if (target) accounts.set(target.id, target);
    accounts.set(admin.id, admin);
    const account_repository = {
        findOneBy: jest.fn(async ({ id, deleted }) => {
            const a = accounts.get(id);
            if (!a || (deleted === false && a.deleted)) return null;
            return Object.assign(new Account(), a);
        }),
        update: jest.fn(async ({ id }, change) => {
            const a = accounts.get(id);
            if (a) Object.assign(a, change);
        })
    };
    const session_repository = { delete: jest.fn(async () => ({ affected: 1 })) };
    const two_factor_repository = {
        countBy: jest.fn(async () => 1),
        delete: jest.fn(async () => ({ affected: 1 }))
    };
    const tracking_manager = {
        update_account_lock: jest.fn(async () => {}),
        update_account_table_locks: jest.fn(async () => {})
    };
    const audit_service = { record: jest.fn(async () => {}) };
    const auth_service = { resend_verification: jest.fn(async () => ({ sent: true })) };
    const account_service = {
        delete_account: jest.fn(async (id: number) => {
            accounts.get(id).deleted = true;
        })
    };
    const service = new AdminService(
        account_repository as any,
        session_repository as any,
        {} as any,
        two_factor_repository as any,
        {} as any,
        tracking_manager as any,
        {} as any,
        {} as any,
        {} as any,
        audit_service as any,
        auth_service as any,
        account_service as any
    );
    return {
        service,
        accounts,
        audit_service,
        tracking_manager,
        session_repository,
        two_factor_repository,
        auth_service,
        account_service
    };
}

async function status_of(promise: Promise<unknown>) {
    try {
        await promise;
        return 200;
    } catch (ex) {
        return ex instanceof HttpException ? ex.getStatus() : 500;
    }
}

describe('AdminService actions', () => {
    it('changes the plan, updates the locks and logs it with the admin as the actor', async () => {
        const s = setup();
        expect(await s.service.change_plan(admin, '2', { plan: 'PRO' })).toEqual({ plan: 'PRO' });
        expect(s.accounts.get(2)).toMatchObject({
            subscription_id: PLAN_SUBSCRIPTIONS.PRO,
            internal: false
        });
        expect(s.tracking_manager.update_account_lock).toHaveBeenCalled();
        expect(s.tracking_manager.update_account_table_locks).toHaveBeenCalled();
        const [target, file_id, changes, opts] = s.audit_service.record.mock.calls[0] as any;
        expect(target.id).toBe(2);
        expect(file_id).toBeNull();
        expect(changes[0]).toMatchObject({
            action: 'admin.plan_changed',
            details: { from: 'Free', to: 'Pro' }
        });
        expect(opts.actor).toEqual({ type: 'admin', label: 'InvokeDB admin (owner@example.com)' });
    });

    it('puts an account on internal and refuses unknown plans', async () => {
        const s = setup();
        expect(await s.service.change_plan(admin, 2, { plan: 'INTERNAL' })).toEqual({
            plan: 'INTERNAL'
        });
        expect(s.accounts.get(2).internal).toBe(true);
        expect(await status_of(s.service.change_plan(admin, 2, { plan: 'GOLD' }))).toBe(400);
    });

    it("refuses actions on the admin's own account and on unknown or deleted ones", async () => {
        const s = setup(account({ id: 3, deleted: true }));
        expect(await status_of(s.service.lock(admin, 1, {}))).toBe(400);
        expect(await status_of(s.service.lock(admin, 3, {}))).toBe(404);
        expect(await status_of(s.service.lock(admin, 99, {}))).toBe(404);
        expect(await status_of(s.service.lock(admin, 'x', {}))).toBe(404);
        expect(s.audit_service.record).not.toHaveBeenCalled();
    });

    it('locks with a reason and unlocks', async () => {
        const s = setup();
        expect(await s.service.lock(admin, 2, { reason: 'Spam' })).toEqual({
            locked: true,
            locked_reason: 'Spam'
        });
        expect(s.accounts.get(2)).toMatchObject({ locked: true, locked_reason: 'Spam' });
        expect(await s.service.unlock(admin, 2)).toEqual({ locked: false });
        expect(s.accounts.get(2)).toMatchObject({ locked: false, locked_reason: null });
        expect(await status_of(s.service.unlock(admin, 2))).toBe(409);
        const actions = s.audit_service.record.mock.calls.map((c: any) => c[2][0].action);
        expect(actions).toEqual(['admin.locked', 'admin.unlocked']);
    });

    it('resends the verification email only to an unverified account', async () => {
        const s = setup();
        expect(await s.service.resend_verification(admin, 2)).toEqual({ sent: true });
        expect(s.auth_service.resend_verification).toHaveBeenCalledWith(2);
        s.accounts.get(2).email_verified = true;
        expect(await status_of(s.service.resend_verification(admin, 2))).toBe(409);
    });

    it('resets two-factor, or says it is off', async () => {
        const s = setup();
        expect(await s.service.reset_two_factor(admin, 2)).toEqual({ two_factor: false });
        expect(s.two_factor_repository.countBy).toHaveBeenCalledWith({
            account_id: 2,
            enabled: true
        });
        expect(s.two_factor_repository.delete).toHaveBeenCalledWith({ account_id: 2 });
        expect(s.audit_service.record).toHaveBeenCalledTimes(1);
        // Off, or only a setup started and never enabled: 409 and nothing in the History
        s.two_factor_repository.countBy.mockResolvedValueOnce(0);
        expect(await status_of(s.service.reset_two_factor(admin, 2))).toBe(409);
        expect(s.audit_service.record).toHaveBeenCalledTimes(1);
    });

    it('does not keep a snapshot that was being built when an action happened', async () => {
        const s = setup();
        let finish: (snap: any) => void = () => {};
        const build = jest
            .spyOn(s.service as any, 'build_snapshot')
            .mockImplementationOnce(() => new Promise(resolve => (finish = resolve)))
            .mockImplementation(async () => ({ at: Date.now(), fresh: true }));
        const stale = s.service.snapshot();
        await s.service.lock(admin, 2, { reason: 'Spam' });
        finish({ at: Date.now(), fresh: false });
        expect(await stale).toMatchObject({ fresh: false });
        expect(await s.service.snapshot()).toMatchObject({ fresh: true });
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('deletes only with the email typed again, then ends the sessions', async () => {
        const s = setup();
        expect(await status_of(s.service.delete_account(admin, 2, { confirm: 'nope' }))).toBe(400);
        expect(s.account_service.delete_account).not.toHaveBeenCalled();
        expect(
            await s.service.delete_account(admin, 2, { confirm: 'Customer@example.com' })
        ).toEqual({ deleted: true });
        expect(s.account_service.delete_account).toHaveBeenCalledWith(2);
        expect(s.session_repository.delete).toHaveBeenCalledWith({ account_id: 2 });
        expect((s.audit_service.record.mock.calls[0] as any)[2][0].action).toBe(
            'admin.account_deleted'
        );
        expect(await status_of(s.service.lock(admin, 2, {}))).toBe(404);
    });
});
