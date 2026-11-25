import { store } from '@/store';

// The plans (#129). PLACEHOLDERS until the pricing review (#137): keep these in step with
// packages/horizon-be/src/core/billing/plans.ts (the caps the server enforces) and the Stripe
// price (STRIPE_PRICE_ID).
const PLANS = [
    {
        id: 'free',
        name: 'Free',
        price: '$0',
        limits: {
            max_tables: '3',
            max_rows: '1,000',
            max_columns: '52',
            max_api_calls_per_month: '1,000'
        }
    },
    {
        id: 'pro',
        name: 'Pro',
        price: '$9.99',
        limits: {
            max_tables: '100',
            max_rows: '100,000',
            max_columns: '52',
            max_api_calls_per_month: '100,000'
        }
    }
];

const RESOURCES = [
    { key: 'max_tables', title: 'Tables', label: 'Tables' },
    { key: 'max_rows', title: 'Rows per table', label: 'Rows per table' },
    {
        key: 'max_columns',
        title: 'Columns per table',
        label: 'Columns per table'
    },
    {
        key: 'max_api_calls_per_month',
        title: 'API calls per month',
        label: 'API calls per month'
    }
];

const FEATURES = [
    'Create new tables',
    'Row editing',
    'CSV upload',
    'Column filtering',
    'Column indexing',
    'Column types',
    'Column sorting'
];

export default {
    name: 'Pricing',

    data() {
        return {
            account: null,
            plans: PLANS,
            resources: RESOURCES,
            features: FEATURES,
            // The app's account page starts Stripe Checkout (a full page load into /app)
            upgrade_url: '/app/account?billing=upgrade'
        };
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
