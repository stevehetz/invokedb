import screenshot_row_edit from '@/assets/screenshot-row-edit.png';
import screenshot_column_edit from '@/assets/screenshot-column-edit.png';
import screenshot_filter from '@/assets/screenshot-filter.png';
import { highlight_code_blocks } from '@/core/utils/highlight';
import { store } from '@/store';
import cookies from 'js-cookie';
import { auth_http } from '@/core/context/account/auth-http';
import { APP_PATH } from '@/router';

import * as samples from './code-samples';

export default {
    name: 'Home',

    data() {
        return {
            screenshots: [
                screenshot_row_edit,
                screenshot_column_edit,
                screenshot_filter
            ],
            code: {
                search: samples.search,
                create: samples.create,
                update: samples.update,
                remove: samples.remove
            },
            active_code: 'create',
            account: null,
            // "Try the demo" (#333): making the demo account, and why it couldn't be
            demo: { starting: false, error: '' }
        };
    },

    computed: {
        demo_label() {
            return this.demo.starting
                ? 'Setting up your demo…'
                : 'Try the demo';
        }
    },

    mounted() {
        this.highlight();
        store.subscribe('account', account => {
            this.account = account;
        });
    },

    methods: {
        highlight() {
            highlight_code_blocks();
        },

        change_code_sample(type) {
            this.active_code = type;
            window.setTimeout(() => this.highlight(), 0);
        },

        /**
         * A throwaway account filled with the showcase tables (#333), signed in like a
         * login. Past its limits (per IP, or the server busy) the reason shows, with signup.
         */
        async try_demo() {
            if (this.demo.starting) return;
            this.demo.starting = true;
            this.demo.error = '';
            try {
                const session = await auth_http.demo();
                cookies.set('token', session.token);
                this.$router.push(APP_PATH);
            } catch (ex) {
                this.demo.error =
                    (ex && typeof ex.message === 'string' && ex.message) ||
                    "The demo couldn't start. Try again, or sign up.";
                this.demo.starting = false;
            }
        }
    }
};
