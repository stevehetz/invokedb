// Google and GitHub sign-in, the browser side. The flow: sso_start() sends the browser to the
// backend's /auth/<provider> with a random nonce (kept in sessionStorage), the provider sends it
// back to the backend, and the backend redirects to /login#sso_token=…&nonce=… (or
// /login?sso_error=<code>). The login page calls sso_finish(), which only accepts the token when
// the nonce matches, so a link carrying someone else's token can't sign this browser in.
import { auth_http } from '@/core/context/account/auth-http';

const NONCE_KEY = 'sso_nonce';

const ERRORS = {
    no_verified_email:
        'Your account with that provider has no verified email address. Verify one there, or sign up with a password.',
    account_deleted: 'The InvokeDB account for that email has been deleted.',
    password_account:
        'An InvokeDB account with that email already has a password. Sign in with your email and password.',
    cancelled: 'Sign-in was cancelled.',
    failed: 'Sign-in failed. Please try again.'
};

function random_nonce() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export function sso_start(provider) {
    const nonce = random_nonce();
    sessionStorage.setItem(NONCE_KEY, nonce);
    window.location.href = auth_http.sso_start_url(provider, nonce);
}

// Reads the result of a sign-in from the current URL and clears it from the address bar.
// Returns { token } on success, { error } on failure, or null when the URL has neither.
export function sso_finish() {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const query = new URLSearchParams(window.location.search);
    const token = hash.get('sso_token');
    const code = query.get('sso_error');
    if (!token && !code) return null;

    window.history.replaceState(null, '', window.location.pathname);
    const expected = sessionStorage.getItem(NONCE_KEY);
    sessionStorage.removeItem(NONCE_KEY);

    if (code) return { error: ERRORS[code] || ERRORS.failed };
    if (!expected || hash.get('nonce') !== expected) {
        return { error: ERRORS.failed };
    }
    return { token };
}
