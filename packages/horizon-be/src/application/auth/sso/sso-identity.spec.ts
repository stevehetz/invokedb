import {
    github_identity,
    google_identity,
    sso_callback_url,
    sso_enabled,
    sso_error_url,
    sso_success_url,
    valid_nonce
} from './sso-identity';

describe('google_identity', () => {
    it('takes a verified email and the name', () => {
        const id = google_identity({
            id: '123',
            emails: [{ value: 'a@b.com', verified: true }],
            name: { givenName: 'Ann', familyName: 'Lee' }
        });
        expect(id).toEqual({
            provider: 'google',
            provider_user_id: '123',
            email: 'a@b.com',
            first_name: 'Ann',
            last_name: 'Lee'
        });
    });

    it('accepts verified as the string "true"', () => {
        const id = google_identity({ id: '1', emails: [{ value: 'a@b.com', verified: 'true' }] });
        expect(id.email).toBe('a@b.com');
    });

    it('never returns an unverified email', () => {
        expect(
            google_identity({ id: '1', emails: [{ value: 'a@b.com', verified: false }] }).email
        ).toBeNull();
        expect(google_identity({ id: '1', emails: [{ value: 'a@b.com' }] }).email).toBeNull();
        expect(
            google_identity({ id: '1', emails: [{ value: 'a@b.com', verified: 'false' }] }).email
        ).toBeNull();
        expect(google_identity({ id: '1' }).email).toBeNull();
    });
});

describe('github_identity', () => {
    it('takes the primary verified email and splits the display name', () => {
        const id = github_identity({
            id: 42,
            displayName: 'Ann Marie Lee',
            emails: [
                { value: 'other@b.com', primary: false, verified: true },
                { value: 'main@b.com', primary: true, verified: true }
            ]
        });
        expect(id).toEqual({
            provider: 'github',
            provider_user_id: '42',
            email: 'main@b.com',
            first_name: 'Ann',
            last_name: 'Marie Lee'
        });
    });

    it('never returns an unverified primary email, nor falls back to a non-primary one', () => {
        const id = github_identity({
            id: 42,
            emails: [
                { value: 'main@b.com', primary: true, verified: false },
                { value: 'other@b.com', primary: false, verified: true }
            ]
        });
        expect(id.email).toBeNull();
    });

    it('ignores emails without flags (the default passport-github2 shape)', () => {
        expect(github_identity({ id: 1, emails: [{ value: 'a@b.com' }] }).email).toBeNull();
    });

    it('handles a missing display name', () => {
        const id = github_identity({ id: 1 });
        expect(id.first_name).toBeNull();
        expect(id.last_name).toBeNull();
    });
});

describe('sso config', () => {
    const env = {
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'secret',
        HORIZON_BE_PUB_HTTP_URL: 'https://api.example.com/'
    };

    it('is enabled only with an id, a secret and the backend URL', () => {
        expect(sso_enabled('google', env)).toBe(true);
        expect(sso_enabled('github', env)).toBe(false);
        expect(sso_enabled('google', { ...env, GOOGLE_CLIENT_SECRET: '' })).toBe(false);
        expect(sso_enabled('google', { ...env, HORIZON_BE_PUB_HTTP_URL: undefined })).toBe(false);
    });

    it('builds the callback URL', () => {
        expect(sso_callback_url('github', env)).toBe(
            'https://api.example.com/auth/github/callback'
        );
    });
});

describe('redirects and nonce', () => {
    it('puts the token and nonce in the fragment', () => {
        expect(sso_success_url('https://x.com', 'internal_abc', 'n'.repeat(20))).toBe(
            `https://x.com/login#sso_token=internal_abc&nonce=${'n'.repeat(20)}`
        );
    });

    it('sends only an error code', () => {
        expect(sso_error_url('https://x.com', 'no_verified_email')).toBe(
            'https://x.com/login?sso_error=no_verified_email'
        );
    });

    it('validates the nonce', () => {
        expect(valid_nonce('abcdefghijklmnop')).toBe(true);
        expect(valid_nonce('short')).toBe(false);
        expect(valid_nonce('abcdefghijklmnop.')).toBe(false);
        expect(valid_nonce(['abcdefghijklmnop'])).toBe(false);
        expect(valid_nonce(undefined)).toBe(false);
    });
});
