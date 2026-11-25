import { support_http } from '@/core/context/support/support-http';
import { store } from '@/store';

export default {
    name: 'ContactUs',

    data() {
        return {
            account: null,
            submitting: false,
            success: false,
            email: '',
            subject: '',
            message: '',
            error: {
                message: ''
            }
        };
    },

    mounted() {
        if (this.$refs.email) {
            this.$refs.email.focus();
        }
        store.subscribe('account', account => {
            this.account = account;
        });
    },

    methods: {
        back(e) {
            e.preventDefault();
            this.success = false;
        },

        async send(e) {
            e.preventDefault();
            this.error.message = '';
            if (!this.email) {
                this.error.message = 'You must provide an email';
                return;
            }

            if (!this.message) {
                this.error.message = 'You must provide a message';
                return;
            }

            try {
                this.submitting = true;
                await support_http.request({
                    email: this.email,
                    subject: this.subject,
                    message: this.message
                });
                this.success = true;
            } catch (ex) {
                // 429: too many requests (rate-limited); the backend's message says to wait
                this.error.message =
                    ex && ex.status === 429
                        ? ex.message
                        : 'An error occurred when submitting your request. Please try again.';
                this.submitting = false;
            }
        }
    }
};
