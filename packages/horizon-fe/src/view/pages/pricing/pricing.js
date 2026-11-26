import { store } from '@/store';
import { plan_http } from '@/core/context/plan/plan-http';
import { price_label, pricing_rows } from '@/core/context/plan/plan';

// The plan highlighted as "Most popular"
const FEATURED_PLAN = 'STARTER';

// One line under each plan's name (docs/PRICING.md 3.2, "Why these numbers")
/** @type {Record<string, string>} */
const TAGLINES = {
    FREE: 'For trying it out and building a small app',
    STARTER: 'For an app in production',
    PRO: 'For more data and heavier API use'
};

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

        /** The plan the page points people to */
        is_featured(plan) {
            return !!plan && plan.id === FEATURED_PLAN;
        },

        tagline(plan) {
            return TAGLINES[plan.id] || '';
        },

        cta_label(plan) {
            return plan.price_month_usd ? 'Get started' : 'Start free';
        },

        /** Under the price: the yearly price and what it saves, or that Free needs no card */
        year_note(plan) {
            const month = plan.price_month_usd;
            const year = plan.price_year_usd;
            if (!month || !year) return 'Free forever, no card needed';
            const saved = month * 12 - year;
            return saved > 0
                ? `or $${year} a year (save $${saved}), cancel anytime`
                : `or $${year} a year, cancel anytime`;
        }
    }
};
