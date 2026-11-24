import AccountHttp from '@/network/http/account/account-http';
import cookies from 'js-cookie';
import SsoButtons from '@/view/sso/sso-buttons.vue';
import { sso_finish } from '@/view/sso/sso';

const account_http = new AccountHttp();

export default {
    name: 'Login',

    components: { SsoButtons },

    data() {
        return {
            processing: false,
            email: '',
            password: '',
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
            window.location.href = '/app'; // the app: a full page load
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
                let session = await account_http.login({
                    email: this.email,
                    password: this.password
                });
                cookies.set('token', session.token);
                window.location.href = '/app'; // the app: a full page load
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
                this.processing = false;
            }
        }
    }
};
