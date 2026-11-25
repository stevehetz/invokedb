import { http } from '@/core/http';

// The signed-in account's two-factor sign-in (#214): an authenticator app plus recovery codes
export const two_factor_http = {
    /** `{ available, password_account, enabled, enabled_datetime, recovery_codes_left }` */
    status() {
        return http.get(http.get_url('/two-factor'));
    },

    /** A new secret to scan: `{ secret, otpauth_url, qr_code }` (qr_code is a data URI) */
    setup() {
        return http.post(http.get_url('/two-factor/setup'));
    },

    /**
     * @param {string} code the 6-digit code from the app
     * @returns {Promise<{ enabled: boolean, recovery_codes: string[] }>}
     */
    enable(code) {
        return http.post(http.get_url('/two-factor/enable'), { code });
    },

    /** @param {string} code a current code or a recovery code */
    disable(code) {
        return http.post(http.get_url('/two-factor/disable'), { code });
    }
};
