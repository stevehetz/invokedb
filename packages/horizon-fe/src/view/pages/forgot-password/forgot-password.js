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
                    'A link to reset your password has been sent to your inbox.';
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
            }
        }
    }
};
