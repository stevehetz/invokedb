import { auth_http } from '@/core/context/account/auth-http';
import cookies from 'js-cookie';
import SsoButtons from '@/view/sso/sso-buttons.vue';
import { sso_finish } from '@/view/sso/sso';
import { APP_PATH } from '@/router';

export default {
    name: 'Login',

    components: { SsoButtons },

    data() {
        return {
            processing: false,
            email: '',
            password: '',
            // Two-factor sign-in (#214): after the right password, a code from the
            // authenticator app (or a recovery code) and the challenge the login answered
            challenge: '',
            code: '',
            error: {
                message: ''
            }
        };
    },

    created() {
        // Back from Google / GitHub sign-in (see view/sso/sso.js)
        const sso = sso_finish();
        if (sso?.token) {
            this.processing = true;
            cookies.set('token', sso.token);
            this.$router.replace(APP_PATH);
        } else if (sso?.error) {
            this.error.message = sso.error;
        }
    },

    mounted() {
        if (this.$refs.email) {
            this.$refs.email.focus();
        }
    },

    methods: {
        async login(e) {
            e.preventDefault();
            this.processing = true;
            try {
                let session = await auth_http.login({
                    email: this.email,
                    password: this.password
                });
                if (session && session.two_factor_required) {
                    this.challenge = session.challenge;
                    this.code = '';
                    this.password = '';
                    this.error.message = '';
                    this.processing = false;
                    this.$nextTick(() => {
                        if (this.$refs.code) this.$refs.code.focus();
                    });
                    return;
                }
                this.signed_in(session);
            } catch (ex) {
                this.error.message = (ex && ex.message) || 'Server error';
                this.processing = false;
            }
        },

        async submit_code(e) {
            if (e) e.preventDefault();
            if (!this.code.trim()) return;
            this.processing = true;
            try {
                const session = await auth_http.login_two_factor({
                    challenge: this.challenge,
                    code: this.code.trim()
                });
                this.signed_in(session);
            } catch (ex) {
                this.error.message = (ex && ex.message) || 'Server error';
                // A gone challenge (expired, too many tries) needs the password again
                if (ex && /expired/i.test(String(ex.message))) this.restart();
                this.processing = false;
            }
        },

        // Back to the email and password
        restart(e) {
            if (e) {
                e.preventDefault();
                this.error.message = '';
            }
            this.challenge = '';
            this.code = '';
        },

        signed_in(session) {
            cookies.set('token', session.token);
            this.$router.push(APP_PATH);
        }
    }
};
