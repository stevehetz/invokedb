import AccountHttp from '@/network/http/account/account-http';
import { store } from '@/store';

const account_http = new AccountHttp();

export default {
    name: 'ResetPassword',

    data() {
        return {
            env: null,
            token: '',
            email: '',
            password: '',
            retype_password: '',
            error: {
                message: ''
            }
        };
    },

    async mounted() {
        this.env = store.get('env');

        this.token = this.get_token();
        if (!this.token) window.location.href = '/';

        try {
            let account = await account_http.confirm_reset_token(this.token);
            if (!account) window.location.href = '/';
            this.email = account.email;
            if (this.$refs.password) this.$refs.password.focus();
        } catch (ex) {
            window.location.href = '/';
        }
    },

    methods: {
        async send(e) {
            e.preventDefault();
            try {
                let { valid, message } = this.validate();

                if (!valid) throw new Error(message);

                await account_http.change_password({
                    token: this.token,
                    password: this.password
                });

                window.location.href = '/';
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
            }
        },

        validate() {
            if (!this.password) {
                return {
                    valid: false,
                    message: 'You must provide a password'
                };
            }

            if (this.password !== this.retype_password) {
                return {
                    valid: false,
                    message: 'Passwords do not match'
                };
            }

            return { valid: true };
        },

        get_token() {
            let url_params = new URLSearchParams(window.location.search);
            return url_params.get('token');
        }
    }
};
