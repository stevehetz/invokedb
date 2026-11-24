import { auth_http } from '@/core/context/account/auth-http';
import cookies from 'js-cookie';

export default {
    name: 'Login',

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
                window.location.href = '/app'; // the app: a full page load
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
                this.processing = false;
            }
        }
    }
};
