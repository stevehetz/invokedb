// Two-factor sign-in (#214): turn on an authenticator app (scan a QR code, confirm with a
// code), see the 10 recovery codes once, and turn it off with a code. Only for accounts with a
// password: Google and GitHub sign-in use the provider's own two-factor.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { bus } from '@/core/bus';
import { two_factor_http } from '@/core/context/two-factor/two-factor-http';

function error_message(ex, fallback) {
    if (ex && typeof ex.message === 'string') return ex.message;
    if (ex && Array.isArray(ex.message)) return ex.message.join(', ');
    return fallback;
}

export default defineComponent({
    name: 'TwoFactorForm',

    data() {
        return {
            loading: true,
            load_error: null,
            /** @type {any} */
            status: null,
            busy: false,
            // The setup in progress: { secret, otpauth_url, qr_code }
            /** @type {any} */
            setup: null,
            setup_code: '',
            // Shown once, right after turning it on
            /** @type {string[] | null} */
            recovery_codes: null,
            show_disable: false,
            disable_code: ''
        };
    },

    computed: {
        enabled() {
            return !!(this.status && this.status.enabled);
        },

        recovery_text() {
            return (this.recovery_codes || []).join('\n');
        }
    },

    mounted() {
        this.load();
    },

    methods: {
        async load() {
            try {
                this.status = await two_factor_http.status();
                this.load_error = null;
            } catch (ex) {
                this.load_error = error_message(
                    ex,
                    "Couldn't load your two-factor settings"
                );
            }
            this.loading = false;
        },

        async start_setup() {
            this.busy = true;
            try {
                this.setup = await two_factor_http.setup();
                this.setup_code = '';
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    error_message(ex, "Couldn't start the setup")
                );
            }
            this.busy = false;
        },

        cancel_setup() {
            this.setup = null;
            this.setup_code = '';
        },

        async confirm_setup() {
            if (!this.setup_code.trim() || this.busy) return;
            this.busy = true;
            try {
                const res = await two_factor_http.enable(
                    this.setup_code.trim()
                );
                this.recovery_codes = res.recovery_codes || [];
                this.setup = null;
                this.setup_code = '';
                await this.load();
                bus.$emit('notify:success', 'Two-factor sign-in is on');
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    error_message(ex, "Couldn't turn on two-factor sign-in")
                );
            }
            this.busy = false;
        },

        copy_secret() {
            if (this.setup) copy(this.setup.secret);
        },

        copy_recovery_codes() {
            copy(this.recovery_text);
            bus.$emit('notify:success', 'Recovery codes copied');
        },

        open_disable() {
            this.show_disable = true;
            this.disable_code = '';
        },

        async disable() {
            if (!this.disable_code.trim() || this.busy) return;
            this.busy = true;
            try {
                await two_factor_http.disable(this.disable_code.trim());
                this.show_disable = false;
                this.disable_code = '';
                this.recovery_codes = null;
                await this.load();
                bus.$emit('notify:success', 'Two-factor sign-in is off');
            } catch (ex) {
                bus.$emit(
                    'notify:error',
                    error_message(ex, "Couldn't turn off two-factor sign-in")
                );
            }
            this.busy = false;
        }
    }
});
