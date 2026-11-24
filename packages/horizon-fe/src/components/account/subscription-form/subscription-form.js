export default {
    name: 'SubscriptionForm',

    data() {
        return {
            loading: true,
            pricing_link: null,
            account_locked: false,
            account_locked_reason: null
        };
    },

    props: ['account'],

    watch: {
        account: function (_account) {
            this.account_locked = _account.locked;
            this.account_locked_reason = _account.locked_reason;
            this.loading = false;
        }
    },

    async mounted() {
        this.pricing_link = '/pricing';
    }
};
