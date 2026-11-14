import { store } from '@/store';

export default {
    name: 'Pricing',

    data() {
        return { account: null };
    },

    mounted() {
        store.subscribe('account', account => {
            this.account = account;
            if (account) {
                this.set_checkout_link(account);
            }
        });
    },

    methods: {
        go_to_database(e) {
            e.preventDefault();
            window.location.href = '/app';
        },

        set_checkout_link(account) {
            this.checkout_link = '/checkout';
            if (account.subscription) {
                this.checkout_link += '?existing_plan=true';
            }

            console.log(this.checkout_link);
        }
    }
};
