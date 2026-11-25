import { auth_http } from '@/core/context/account/auth-http';
import SsoButtons from '@/view/sso/sso-buttons.vue';

export default {
    name: 'CreateAccount',

    components: { SsoButtons },

    data() {
        return {
            email: '',
            password: '',
            retype_password: '',
            // Set once the signup went through: the page then says "Check your email"
            sent_to: '',
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
            if (this.sent_to) return;
            try {
                let { valid, message } = this.validate();

                if (!valid) throw new Error(message);

                // The answer is the same whether or not the email already has an account
                // (#132), so this doesn't sign in: for a taken email the password wouldn't
                // work, which would tell anyone the email has an account
                await auth_http.create_account({
                    email: this.email,
                    password: this.password
                });

                this.error.message = '';
                this.sent_to = this.email;
                this.password = '';
                this.retype_password = '';
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
