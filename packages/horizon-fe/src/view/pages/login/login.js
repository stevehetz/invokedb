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
                cookies.set('token', session.token);
                this.$router.push(APP_PATH);
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
                this.processing = false;
            }
        }
    }
};
