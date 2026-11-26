import { HttpException, NotFoundException } from '@nestjs/common';
import { Account } from '@app/core/account/account.entity';
import { Session } from '@app/core/session/session.entity';
import { AdminAccessService } from '@app/application/admin/admin-access.service';
import { parse_admin_emails } from '@app/core/admin/admin';
import { ADMIN_ACTIONS_PER_10_MINUTES, ADMIN_REQUESTS_PER_MINUTE, AdminGuard } from './admin.guard';

// The bearer strategy's part (AuthGuard('bearer')) is replaced: it sets req.user, or fails
const bearer = Object.getPrototypeOf(AdminGuard.prototype);

function session(account_id: number) {
    const s = new Session();
    s.account_id = account_id;
    s.token = 'internal_t';
    return s;
}

function account(over: Partial<Account> = {}) {
    const a = new Account();
    Object.assign(a, {
        id: 1,
        email: 'owner@example.com',
        email_verified: true,
        deleted: false,
        ...over
    });
    return a;
}

function setup(opts: { emails?: string; two_factor?: boolean; account?: Account | null } = {}) {
    const stored = opts.account === undefined ? account() : opts.account;
    const access = new AdminAccessService(
        {
            findOneBy: jest.fn(async ({ id }) => (stored && stored.id === id ? stored : null))
        } as any,
        { is_enabled: jest.fn(async () => opts.two_factor !== false) } as any
    );
    access.admin_emails = () => parse_admin_emails(opts.emails ?? 'owner@example.com');
    return new AdminGuard(access);
}

function context(user: unknown, method = 'GET') {
    const req: any = { user, method };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req }) };
    return { ctx, req };
}

async function status_of(promise: Promise<unknown>) {
    try {
        await promise;
        return 200;
    } catch (ex) {
        return ex instanceof HttpException ? ex.getStatus() : 500;
    }
}

describe('AdminGuard', () => {
    let spy: jest.SpyInstance;
    let user: unknown;
    beforeEach(() => {
        user = session(1);
        spy = jest.spyOn(bearer, 'canActivate').mockImplementation(async function (ctx: any) {
            if (!user) throw new Error('Unauthorized');
            ctx.switchToHttp().getRequest().user = user;
            return true;
        });
    });
    afterEach(() => spy.mockRestore());

    it('lets an admin through and puts the account on req.admin', async () => {
        const { ctx, req } = context(null);
        expect(await setup().canActivate(ctx)).toBe(true);
        expect(req.admin.email).toBe('owner@example.com');
    });

    it('answers 404 without a session', async () => {
        user = null;
        expect(await status_of(setup().canActivate(context(null).ctx))).toBe(404);
    });

    it('answers 404 for an API key (an Account, not a Session)', async () => {
        user = account();
        await expect(setup().canActivate(context(null).ctx)).rejects.toBeInstanceOf(
            NotFoundException
        );
    });

    it('answers 404 for someone not on the list, or with an empty list', async () => {
        user = session(1);
        expect(
            await status_of(setup({ emails: 'else@example.com' }).canActivate(context(0).ctx))
        ).toBe(404);
        expect(await status_of(setup({ emails: '' }).canActivate(context(0).ctx))).toBe(404);
    });

    it('answers 404 without two-factor, a verified email, or for a deleted account', async () => {
        expect(await status_of(setup({ two_factor: false }).canActivate(context(0).ctx))).toBe(404);
        expect(
            await status_of(
                setup({ account: account({ email_verified: false }) }).canActivate(context(0).ctx)
            )
        ).toBe(404);
        expect(
            await status_of(
                setup({ account: account({ deleted: true }) }).canActivate(context(0).ctx)
            )
        ).toBe(404);
        expect(await status_of(setup({ account: null }).canActivate(context(0).ctx))).toBe(404);
    });

    it('rate-limits requests and, more tightly, actions', async () => {
        const guard = setup();
        for (let i = 0; i < ADMIN_ACTIONS_PER_10_MINUTES; i++) {
            expect(await guard.canActivate(context(null, 'POST').ctx)).toBe(true);
        }
        expect(await status_of(guard.canActivate(context(null, 'POST').ctx))).toBe(429);
        const reads = setup();
        for (let i = 0; i < ADMIN_REQUESTS_PER_MINUTE; i++) {
            await reads.canActivate(context(null).ctx);
        }
        expect(await status_of(reads.canActivate(context(null).ctx))).toBe(429);
    });
});
