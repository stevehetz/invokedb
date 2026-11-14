import AccountHttp from '@/network/http/account/account-http';
import cookies from 'js-cookie';
import { store } from '@/store';

const account_http = new AccountHttp();

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
                let session = await account_http.login({
                    email: this.email,
                    password: this.password
                });
                let url = store.get('env').HORIZON_FE_PUB_HTTP_URL;
                cookies.set('token', session.token);
                window.location.href = `${url}?token=${session.token}`;
            } catch (ex) {
                this.error.message = ex.message || 'Server error';
                this.processing = false;
            }
        }
    }
};
