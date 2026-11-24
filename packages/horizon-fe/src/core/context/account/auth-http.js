import { http } from '@/core/http';

// The /auth endpoints the public site uses (login, signup, password reset, SSO)
export const auth_http = {
    login(data) {
        return http.post(http.get_url('/auth/login'), data);
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
