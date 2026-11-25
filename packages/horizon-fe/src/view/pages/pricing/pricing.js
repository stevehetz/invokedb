import { store } from '@/store';
import { plan_http } from '@/core/context/plan/plan-http';
import { price_label, pricing_rows } from '@/core/context/plan/plan';

export default {
    name: 'Pricing',

    data() {
        return {
            account: null,
            loading: true,
            error: '',
            // From GET /plans (#183), so the page can't disagree with what the backend enforces
            plans: [],
            // What every plan has
            features: [
                'Tables you query through an API',
                'CSV upload and import from a URL',
                'Forms, views and webhooks',
                'Two-factor sign-in',
                'Export of all your data'
            ]
        };
    },

    computed: {
        rows() {
            return pricing_rows(this.plans);
        }
    },

    async mounted() {
        store.subscribe('account', account => {
            this.account = account;
        });
        try {
            const res = await plan_http.plans();
            this.plans = (res && res.plans) || [];
        } catch (ex) {
            this.error = "The plans couldn't be loaded. Try again in a moment.";
        } finally {
            this.loading = false;
        }
    },

    methods: {
        price_label,

        /** Under the plan's name: paid plans can be cancelled, Free needs no card */
        plan_note(plan) {
            return plan.price_year_usd ? 'cancel anytime' : 'no card needed';
        }
    }
};
