import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AccountManager } from '@app/core/account/account.manager';

// uuid is ESM-only, which Jest can't load (AccountManager imports it)
jest.mock('uuid', () => ({ v4: () => jest.requireActual('crypto').randomUUID() }));

// Signup and email verification (#132), with the repositories and email faked
const TOKEN = '0b6f3c3e-2f7a-4d5e-9b1c-7a8d9e0f1a2b';
const PASSWORD = 'Passw0rd!';

function setup(
    opts: { existing?: any; verification?: any; account?: any; two_factor?: boolean } = {}
) {
    const sent: Array<{ to: string; subject: string; body: string }> = [];
    const account_repository = {
        save: jest.fn(async (a: any) => ({ id: 41, ...a })),
        update: jest.fn(async () => ({})),
        findOneBy: jest.fn(async (where: any) => {
            // get_unique_api_key looks up each key it generates: none is taken
            if (where.api_key) return null;
            return opts.account ?? null;
        })
    };
    const email_verification_repository = {
        save: jest.fn(async (v: any) => v),
        delete: jest.fn(async () => ({})),
        findOneBy: jest.fn(async () => opts.verification ?? null)
    };
    const account_manager = new AccountManager(account_repository as any, {} as any);
    jest.spyOn(account_manager, 'hash_password').mockResolvedValue('hash');
    jest.spyOn(account_manager, 'find_by_email_any_case').mockResolvedValue(opts.existing ?? null);
    const email_manager = {
        send_html: jest.fn((to: string, subject: string, body: string) => {
            sent.push({ to, subject, body });
            return 'success';
        })
    };

    // The funnel's times (#169)
    const onboarding_manager = {
        record_signup: jest.fn(async () => {}),
        record_email_verified: jest.fn(async () => {})
    };

    const session_manager = {
        create_session: jest.fn(async (account_id: number) => ({ token: 'internal_t', account_id }))
    };
    // Two-factor sign-in (#214): on when opts.two_factor is set
    const two_factor_service = {
        is_enabled: jest.fn(async () => !!opts.two_factor),
        start_login: jest.fn(() => 'challenge-token'),
        finish_login: jest.fn(async () => opts.account)
    };
    const service = new AuthService(
        {} as any,
        account_repository as any,
        {} as any,
        {} as any,
        email_verification_repository as any,
        account_manager,
        session_manager as any,
        email_manager as any,
        {} as any,
        onboarding_manager as any,
        two_factor_service as any
    );
    return {
        service,
        session_manager,
        two_factor_service,
        account_repository,
        email_verification_repository,
        account_manager,
        onboarding_manager,
        sent
    };
}

async function status_of(promise: Promise<unknown>) {
    try {
        await promise;
    } catch (ex) {
        return ex instanceof HttpException ? ex.getStatus() : 'error';
    }
    return 'ok';
}

describe('AuthService.create_account', () => {
    it('creates an unverified account and sends it a verification link', async () => {
        const t = setup();
        const answer = await t.service.create_account({ email: 'new@x.com', password: PASSWORD });

        expect(t.account_repository.save).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'new@x.com', email_verified: false })
        );
        const [verification] = t.email_verification_repository.save.mock.calls[0] as any[];
        expect(verification.account_id).toBe(41);
        expect(t.sent).toHaveLength(1);
        expect(t.sent[0].to).toBe('new@x.com');
        expect(t.sent[0].body).toContain(`/verify-email?token=${verification.token}`);
        expect(answer).toBe('success');
        expect(t.onboarding_manager.record_signup).toHaveBeenCalledWith(41);
        expect(t.onboarding_manager.record_email_verified).not.toHaveBeenCalled();
    });

    it('answers the same for an email that already has an account, and creates nothing', async () => {
        const fresh = await setup().service.create_account({
            email: 'new@x.com',
            password: PASSWORD
        });
        const t = setup({ existing: { id: 7, email: 'Owner@x.com', deleted: false } });
        const answer = await t.service.create_account({ email: 'owner@x.com', password: PASSWORD });

        expect(answer).toEqual(fresh);
        expect(t.account_repository.save).not.toHaveBeenCalled();
        expect(t.onboarding_manager.record_signup).not.toHaveBeenCalled();
        expect(t.email_verification_repository.save).not.toHaveBeenCalled();
        // The password is still hashed, so both paths take about as long
        expect(t.account_manager.hash_password).toHaveBeenCalled();
        // The owner hears about it, at the address the account has
        expect(t.sent).toHaveLength(1);
        expect(t.sent[0].to).toBe('Owner@x.com');
        expect(t.sent[0].subject).toMatch(/tried to sign up/);
    });

    it('sends nothing for a deleted account, but still answers the same', async () => {
        const t = setup({ existing: { id: 7, email: 'gone@x.com', deleted: true } });
        expect(await t.service.create_account({ email: 'gone@x.com', password: PASSWORD })).toBe(
            'success'
        );
        expect(t.sent).toHaveLength(0);
        expect(t.account_repository.save).not.toHaveBeenCalled();
    });

    it('still rejects a missing email, a bad format or a weak password', async () => {
        const t = setup();
        expect(await status_of(t.service.create_account({ password: PASSWORD }))).toBe(400);
        expect(await status_of(t.service.create_account({ email: 'x', password: PASSWORD }))).toBe(
            400
        );
        expect(await status_of(t.service.create_account({ email: 'a@x.com', password: 'a' }))).toBe(
            400
        );
        expect(t.sent).toHaveLength(0);
    });
});

describe('AuthService.verify_email', () => {
    const later = () => new Date(Date.now() + 60 * 60 * 1000);

    it('marks the account verified and drops its links', async () => {
        const t = setup({
            verification: { token: TOKEN, account_id: 9, expired_datetime: later() }
        });
        expect(await t.service.verify_email(TOKEN)).toEqual({ email_verified: true });
        expect(t.account_repository.update).toHaveBeenCalledWith(
            { id: 9 },
            { email_verified: true }
        );
        expect(t.email_verification_repository.delete).toHaveBeenCalledWith({ account_id: 9 });
        expect(t.onboarding_manager.record_email_verified).toHaveBeenCalledWith(9);
    });

    it('refuses an expired link', async () => {
        const t = setup({
            verification: {
                token: TOKEN,
                account_id: 9,
                expired_datetime: new Date(Date.now() - 1)
            }
        });
        expect(await status_of(t.service.verify_email(TOKEN))).toBe(HttpStatus.BAD_REQUEST);
        expect(t.account_repository.update).not.toHaveBeenCalled();
        expect(t.onboarding_manager.record_email_verified).not.toHaveBeenCalled();
    });

    it('refuses an unknown link, and anything that is not a uuid without a query', async () => {
        const t = setup();
        expect(await status_of(t.service.verify_email(TOKEN))).toBe(400);
        for (const bad of [undefined, '', 'nope', ['x'], 5]) {
            expect(await status_of(t.service.verify_email(bad))).toBe(400);
        }
        expect(t.email_verification_repository.findOneBy).toHaveBeenCalledTimes(1);
        expect(t.account_repository.update).not.toHaveBeenCalled();
    });
});

describe('AuthService.resend_verification', () => {
    it('sends a new link to an unverified account, replacing the old one', async () => {
        const t = setup({ account: { id: 3, email: 'u@x.com', email_verified: false } });
        expect(await t.service.resend_verification(3)).toEqual({
            email_verified: false,
            sent: true
        });
        expect(t.email_verification_repository.delete).toHaveBeenCalledWith({ account_id: 3 });
        expect(t.email_verification_repository.save).toHaveBeenCalled();
        expect(t.sent.map(s => s.to)).toEqual(['u@x.com']);
    });

    it('sends nothing to a verified account', async () => {
        const t = setup({ account: { id: 3, email: 'u@x.com', email_verified: true } });
        expect(await t.service.resend_verification(3)).toEqual({ email_verified: true });
        expect(t.sent).toHaveLength(0);
    });
});

describe('AuthService.login (two-factor, #214)', () => {
    const account = { id: 9, email: 'u@x.com', password_hash: 'hash' };

    it('starts a session when two-factor is off', async () => {
        const t = setup({ account });
        jest.spyOn(t.account_manager, 'authenticate_account').mockResolvedValue(account as any);
        expect(await t.service.login({ email: 'u@x.com', password: PASSWORD })).toEqual({
            token: 'internal_t',
            account_id: 9
        });
        expect(t.two_factor_service.start_login).not.toHaveBeenCalled();
    });

    it('answers a challenge, not a session, when two-factor is on', async () => {
        const t = setup({ account, two_factor: true });
        jest.spyOn(t.account_manager, 'authenticate_account').mockResolvedValue(account as any);
        expect(await t.service.login({ email: 'u@x.com', password: PASSWORD })).toEqual({
            two_factor_required: true,
            challenge: 'challenge-token'
        });
        expect(t.two_factor_service.start_login).toHaveBeenCalledWith(9);
        expect(t.session_manager.create_session).not.toHaveBeenCalled();
    });

    it('never answers a challenge for a wrong password', async () => {
        const t = setup({ account, two_factor: true });
        jest.spyOn(t.account_manager, 'authenticate_account').mockRejectedValue(
            new HttpException('Invalid email or password', HttpStatus.BAD_REQUEST)
        );
        expect(await status_of(t.service.login({ email: 'u@x.com', password: 'x' }))).toBe(400);
        expect(t.two_factor_service.start_login).not.toHaveBeenCalled();
    });

    it('starts the session once the code step passes', async () => {
        const t = setup({ account, two_factor: true });
        expect(await t.service.login_two_factor({ challenge: 'c', code: '123456' })).toEqual({
            token: 'internal_t',
            account_id: 9
        });
        expect(t.two_factor_service.finish_login).toHaveBeenCalledWith('c', '123456');
    });

    it('starts no session when the code step fails', async () => {
        const t = setup({ account, two_factor: true });
        t.two_factor_service.finish_login.mockRejectedValue(
            new HttpException('wrong', HttpStatus.BAD_REQUEST)
        );
        const status = await status_of(t.service.login_two_factor({ challenge: 'c', code: '1' }));
        expect(status).toBe(400);
        expect(t.session_manager.create_session).not.toHaveBeenCalled();
    });
});
