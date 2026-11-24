import { UnauthorizedException } from '@nestjs/common';
import { Session } from '@app/core/session/session.entity';
import { Account } from '@app/core/account/account.entity';
import { session_account_id, api_key_account } from './request-account';

const session = (account_id?: number) => Object.assign(new Session(), { account_id });
const account = (id?: number) => Object.assign(new Account(), { id });

describe('session_account_id (internal routes)', () => {
    it('returns the account id of a login session', () => {
        expect(session_account_id(session(7))).toBe(7);
    });

    it('rejects an API key (an Account), even one with an id', () => {
        expect(() => session_account_id(account(7))).toThrow(UnauthorizedException);
    });

    it('rejects a session without an account', () => {
        expect(() => session_account_id(session())).toThrow(UnauthorizedException);
    });

    it('rejects plain objects that only look like a session', () => {
        expect(() => session_account_id({ account_id: 7 })).toThrow(UnauthorizedException);
    });

    it('rejects a missing user', () => {
        expect(() => session_account_id(undefined)).toThrow(UnauthorizedException);
        expect(() => session_account_id(null)).toThrow(UnauthorizedException);
    });
});

describe('api_key_account (/api/v1)', () => {
    it('returns the account of an API key', () => {
        const a = account(3);
        expect(api_key_account(a)).toBe(a);
    });

    it('rejects a login session', () => {
        expect(() => api_key_account(session(3))).toThrow(UnauthorizedException);
    });

    it('rejects an account without an id', () => {
        expect(() => api_key_account(account())).toThrow(UnauthorizedException);
    });

    it('rejects plain objects that only look like an account', () => {
        expect(() => api_key_account({ id: 3 })).toThrow(UnauthorizedException);
    });
});
