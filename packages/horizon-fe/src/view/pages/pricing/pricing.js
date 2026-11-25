import { store } from '@/store';

export default {
    name: 'Pricing',

    data() {
        return { account: null };
    },

    mounted() {
        store.subscribe('account', account => {
            this.account = account;
        });
    }
};
