import { auth_http } from '@/core/context/account/auth-http';
import cookies from 'js-cookie';

export default {
    name: 'CreateAccount',

    data() {
        return {
            email: '',
            password: '',
            retype_password: '',
            error: {
                message: ''
            }
        };
    },

    mounted() {
        this.$refs.email.focus();
    },

    methods: {
        async create_account(e) {
            e.preventDefault();
            try {
                let { valid, message } = this.validate();

                if (!valid) throw new Error(message);

                await auth_http.create_account({
                    email: this.email,
                    password: this.password
                });

                let session = await auth_http.login({
                    email: this.email,
                    password: this.password
                });
                cookies.set('token', session.token);
                window.location.href = '/app'; // the app: a full page load
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
            }
        },

        validate() {
            if (!this.email) {
                return {
                    valid: false,
                    message: 'You must supply an email'
                };
            }

            if (!this.password) {
                return {
                    valid: false,
                    message: 'You must supply a password'
                };
            }

            if (this.password !== this.retype_password) {
                return {
                    valid: false,
                    message: 'Passwords do not match'
                };
            }

            return { valid: true };
        }
    }
};
