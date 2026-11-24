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
    },

    methods: {
        go_to_database(e) {
            e.preventDefault();
            window.location.href = '/app';
        }
    }
};
