import { http } from '@/core/http';

// The /auth endpoints the public site uses (login, signup, password reset, SSO)
export const auth_http = {
    login(data) {
        return http.post(http.get_url('/auth/login'), data);
    },

    // The home page's "Try the demo" (#333): a fresh demo account, answered as
    // { token, expires_at }; 429 `demo_limit` or 503 `demo_busy` past its limits
    demo() {
        return http.post(http.get_url('/auth/demo'));
    },

    // The code step when two-factor sign-in is on (#214): login answered
    // { two_factor_required, challenge } instead of a session
    login_two_factor(data) {
        return http.post(http.get_url('/auth/login/two-factor'), data);
    },

    authorize(token) {
        return http.get(http.get_url(`/auth/authorize?token=${token}`));
    },

    reset_password(email) {
        const url = http.get_url('/auth/reset-password');
        return http.get(`${url}?email=${encodeURIComponent(email)}`);
    },

    create_account(data) {
        return http.post(http.get_url('/auth/create-account'), data);
    },

    // The link in the verification email (#132)
    verify_email(token) {
        const url = http.get_url('/auth/verify-email');
        return http.get(`${url}?token=${encodeURIComponent(token)}`);
    },

    // Sends the signed-in account a new verification link (the app's banner)
    resend_verification() {
        return http.post(http.get_url('/auth/resend-verification'));
    },

    change_password(data) {
        return http.post(http.get_url('/auth/change-password'), data);
    },

    // { google: bool, github: bool }: which sign-in providers the backend has configured
    sso_providers() {
        return http.get(http.get_url('/auth/sso-providers'));
    },

    // Where the browser goes to start Google / GitHub sign-in (a full page load)
    sso_start_url(provider, nonce) {
        return http.get_url(
            `/auth/${provider}?nonce=${encodeURIComponent(nonce)}`
        );
    },

    confirm_reset_token(token) {
        return http.get(
            http.get_url(`/auth/confirm-reset-token?token=${token}`)
        );
    }
};
