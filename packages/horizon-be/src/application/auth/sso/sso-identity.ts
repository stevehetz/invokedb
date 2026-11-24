// Google and GitHub sign-in: the pure parts (provider config, reading the provider profiles,
// the redirect URLs). The flow is in sso.controller.ts and AuthService.sso_login.

export type SsoProvider = 'google' | 'github';

export const SSO_PROVIDERS: SsoProvider[] = ['google', 'github'];

// What sign-in needs from a provider profile. `email` is set only when the provider says the
// address is verified: an unverified email must never link to (take over) an existing account.
export interface SsoIdentity {
    provider: SsoProvider;
    provider_user_id: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
}

// Error codes sent to the frontend (`/login?sso_error=<code>`), which shows a fixed message for
// each, so a crafted link can't put arbitrary text on the login page.
export type SsoErrorCode = 'no_verified_email' | 'account_deleted' | 'cancelled' | 'failed';

export class SsoError extends Error {
    constructor(readonly code: SsoErrorCode) {
        super(`SSO login failed: ${code}`);
    }
}

export interface SsoEnv {
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    HORIZON_BE_PUB_HTTP_URL?: string;
}

export function sso_credentials(provider: SsoProvider, env: SsoEnv) {
    const [id, secret] =
        provider === 'google'
            ? [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET]
            : [env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET];
    return { client_id: id || '', client_secret: secret || '' };
}

export function sso_enabled(provider: SsoProvider, env: SsoEnv): boolean {
    const { client_id, client_secret } = sso_credentials(provider, env);
    return !!(client_id && client_secret && env.HORIZON_BE_PUB_HTTP_URL);
}

export function sso_callback_url(provider: SsoProvider, env: SsoEnv): string {
    return `${(env.HORIZON_BE_PUB_HTTP_URL || '').replace(/\/+$/, '')}/auth/${provider}/callback`;
}

const is_true = (v: unknown) => v === true || v === 'true';

const text = (v: unknown, max: number): string | null =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

const email_text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;

// passport-google-oauth20 profile: emails = [{ value, verified }] from the OpenID userinfo
export function google_identity(profile: any): SsoIdentity {
    const email = (profile?.emails || []).find((e: any) => e && is_true(e.verified));
    return {
        provider: 'google',
        provider_user_id: String(profile?.id || ''),
        email: email_text(email?.value),
        first_name: text(profile?.name?.givenName, 100),
        last_name: text(profile?.name?.familyName, 100)
    };
}

// passport-github2 profile with `allRawEmails: true`: emails = GitHub's /user/emails list,
// [{ value, primary, verified }]. Take the primary address, and only if it's verified.
export function github_identity(profile: any): SsoIdentity {
    const email = (profile?.emails || []).find(
        (e: any) => e && is_true(e.primary) && is_true(e.verified)
    );
    const [first, ...rest] = (text(profile?.displayName, 201) || '').split(/\s+/);
    return {
        provider: 'github',
        provider_user_id: String(profile?.id || ''),
        email: email_text(email?.value),
        first_name: text(first, 100),
        last_name: text(rest.join(' '), 100)
    };
}

// The nonce the frontend sends to /auth/<provider> and checks when it gets the token back, so a
// token can only finish a sign-in that this browser started.
export function valid_nonce(nonce: unknown): nonce is string {
    return typeof nonce === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(nonce);
}

// The token goes in the fragment, which browsers don't send to servers or in Referer headers.
export function sso_success_url(fe_url: string, token: string, nonce: string): string {
    const params = new URLSearchParams({ sso_token: token, nonce });
    return `${fe_url}/login#${params.toString()}`;
}

export function sso_error_url(fe_url: string, code: SsoErrorCode): string {
    return `${fe_url}/login?sso_error=${code}`;
}
