import { HttpException, HttpStatus } from '@nestjs/common';
import {
    assert_verified,
    creating_needs_verified_email,
    is_verified,
    verify_email_url,
    visible_api_key
} from './email-verification';

describe('is_verified', () => {
    it('is true only for an explicit true', () => {
        expect(is_verified({ email_verified: true })).toBe(true);
        expect(is_verified({ email_verified: false })).toBe(false);
        expect(is_verified({})).toBe(false);
        expect(is_verified(null)).toBe(false);
        expect(is_verified(undefined)).toBe(false);
    });
});

describe('assert_verified', () => {
    it('passes a verified account', () => {
        expect(() => assert_verified({ email_verified: true })).not.toThrow();
    });

    it('answers 403 for an unverified or missing account', () => {
        for (const account of [{ email_verified: false }, null]) {
            try {
                assert_verified(account);
                throw new Error('did not throw');
            } catch (ex) {
                expect(ex).toBeInstanceOf(HttpException);
                expect(ex.getStatus()).toBe(HttpStatus.FORBIDDEN);
            }
        }
    });
});

describe('creating_needs_verified_email', () => {
    it('needs it for a table, not for a folder', () => {
        expect(creating_needs_verified_email({ type: 'file' })).toBe(true);
        expect(creating_needs_verified_email({ type: 'dir' })).toBe(false);
        // Anything else (or nothing) counts as a table
        expect(creating_needs_verified_email({})).toBe(true);
    });
});

describe('verify_email_url', () => {
    it('links to the site page with the token', () => {
        expect(verify_email_url('https://invokedb.com', 'a-b')).toBe(
            'https://invokedb.com/verify-email?token=a-b'
        );
        expect(verify_email_url('https://x', 'a&b')).toBe('https://x/verify-email?token=a%26b');
    });
});

describe('visible_api_key', () => {
    it('shows the key only once the email is verified', () => {
        expect(visible_api_key({ email_verified: true, api_key: 'k' })).toBe('k');
        expect(visible_api_key({ email_verified: false, api_key: 'k' })).toBeNull();
        expect(visible_api_key({ api_key: 'k' })).toBeNull();
    });
});
