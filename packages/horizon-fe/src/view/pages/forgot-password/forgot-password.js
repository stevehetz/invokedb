import { auth_http } from '@/core/context/account/auth-http';

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
                await auth_http.reset_password(this.email);
                this.message =
                    'If an account exists for that email, a link to reset your password has been sent to it.';
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
            }
        }
    }
};
