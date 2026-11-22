import AccountHttp from '@/network/http/account/account-http';

const account_http = new AccountHttp();

export default {
    name: 'ForgotPassword',

    data() {
        return {
            email: '',
            message: '',
            error: {
                message: ''
            }
        };
    },

    mounted() {
        if (this.$refs.email) this.$refs.email.focus();
    },

    methods: {
        async send(e) {
            e.preventDefault();
            try {
                await account_http.reset_password(this.email);
                this.message =
                    'If an account exists for that email, a link to reset your password has been sent to it.';
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
            }
        }
    }
};
