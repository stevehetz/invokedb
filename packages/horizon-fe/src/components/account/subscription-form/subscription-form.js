import { subscription_http } from '@/core/context/subscription/subscription-http';
import { store } from '@/store';
import * as moment from 'moment';

export default {
    name: 'SubscriptionForm',

    data() {
        return {
            loading: true,
            stripe_subscription: null,
            subscription_end_message: null,
            cancel_at_period_end: null,
            pricing_link: null,
            checkout_link: null,
            account_locked: false,
            account_locked_reason: null
        };
    },

    props: ['account'],

    watch: {
        account: async function(_account) {
            this.account_locked = _account.locked;
            this.account_locked_reason = _account.locked_reason;
            this.set_checkout_link(_account);
            await this.set_subscription_info(_account);
            this.loading = false;
        }
    },

    async mounted() {
        const env = store.get('env');
        this.pricing_link = env.HORIZON_AUTH_FE_PUB_HTTP_URL + '/pricing';
    },

    methods: {
        set_checkout_link(account) {
            const env = store.get('env');
            this.checkout_link = env.HORIZON_AUTH_FE_PUB_HTTP_URL + '/checkout';
            if (account.subscription) {
                this.checkout_link += '?existing_plan=true';
            }
        },

        async set_subscription_info(account) {
            if (account.subscription) {
                this.stripe_subscription = await subscription_http.get_stripe_subscription();

                const {
                    cancel_at_period_end,
                    current_period_end
                } = this.stripe_subscription;

                this.cancel_at_period_end = cancel_at_period_end;

                const end_date = moment
                    .unix(current_period_end)
                    .format('MM-DD-YYYY');

                if (cancel_at_period_end) {
                    this.subscription_end_message = `Your subscription will end on ${end_date}`;
                } else {
                    this.subscription_end_message = `Your subscription will renew on ${end_date}`;
                }
            }
        }
    }
};
