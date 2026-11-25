import { EventEmitter } from 'node:events';
import { HttpException } from '@nestjs/common';
import { Account } from '@app/core/account/account.entity';
import { Session } from '@app/core/session/session.entity';
import { ApiKeyUsageGuard } from './api-key-usage.guard';
import { PLAN_SUBSCRIPTIONS, PlanId } from '@app/core/plan/plans';

function context(user: unknown, url = '/api/v1/get?table=private') {
    const res: any = Object.assign(new EventEmitter(), { statusCode: 200 });
    const req = { user, method: 'GET', originalUrl: url };
    const ctx: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
    return { ctx, res };
}

// Per-key limits and logs are for Starter and Pro (#183)
function key_account(rate_limit = null, plan_id: PlanId = 'STARTER') {
    const account = new Account();
    account.id = 7;
    account.subscription_id = PLAN_SUBSCRIPTIONS[plan_id];
    account.key_scope = { key_id: 3, access: 'read', table_ids: null, rate_limit };
    return account;
}

describe('ApiKeyUsageGuard', () => {
    let record: jest.Mock;
    let guard: ApiKeyUsageGuard;
    beforeEach(() => {
        record = jest.fn().mockResolvedValue(undefined);
        guard = new ApiKeyUsageGuard({ record } as any);
    });

    it('logs a key call once the response is sent, without the query string', () => {
        const { ctx, res } = context(key_account());
        expect(guard.canActivate(ctx)).toBe(true);
        expect(record).not.toHaveBeenCalled();
        res.statusCode = 201;
        res.emit('finish');
        expect(record).toHaveBeenCalledTimes(1);
        const [account_id, key_id, entry] = record.mock.calls[0];
        expect([account_id, key_id]).toEqual([7, 3]);
        expect(entry).toMatchObject({ method: 'GET', path: '/api/v1/get', status: 201 });
    });

    it('lets a key without a limit through every time', () => {
        for (let i = 0; i < 50; i++)
            expect(guard.canActivate(context(key_account()).ctx)).toBe(true);
    });

    it('answers 429 with retry_after past the key limit, and logs that too', () => {
        const limit: any = { per_second: 1, burst: 2 };
        expect(guard.canActivate(context(key_account(limit)).ctx)).toBe(true);
        expect(guard.canActivate(context(key_account(limit)).ctx)).toBe(true);
        const { ctx, res } = context(key_account(limit));
        let err: any;
        try {
            guard.canActivate(ctx);
        } catch (e) {
            err = e;
        }
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(429);
        expect(err.getResponse().retry_after).toBeGreaterThanOrEqual(1);
        res.statusCode = 429;
        res.emit('finish');
        expect(record.mock.calls.at(-1)[2].status).toBe(429);
    });

    it('on Free, neither limits nor logs a key (#183): only the account limits apply', () => {
        const limit: any = { per_second: 1, burst: 1 };
        for (let i = 0; i < 5; i++) {
            const { ctx, res } = context(key_account(limit, 'FREE'));
            expect(guard.canActivate(ctx)).toBe(true);
            res.emit('finish');
        }
        expect(record).not.toHaveBeenCalled();
    });

    it('does nothing for a login session', () => {
        const { ctx, res } = context(new Session());
        expect(guard.canActivate(ctx)).toBe(true);
        res.emit('finish');
        expect(record).not.toHaveBeenCalled();
    });
});
