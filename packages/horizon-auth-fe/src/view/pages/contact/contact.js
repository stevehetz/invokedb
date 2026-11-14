import SupportHttp from '@/network/http/support/support-http';
import { store } from '@/store';

const support_http = new SupportHttp();

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
        go_to_database(e) {
            e.preventDefault();
            window.location.href = store.get('env').HORIZON_FE_PUB_HTTP_URL;
        },

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
                this.error.message =
                    'An error occurred when submitting your request. Please try again.';
                this.submitting = false;
            }
        }
    }
};
