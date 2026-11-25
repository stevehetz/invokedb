import { billing_http } from '@/core/context/account/billing-http';

const PLAN_NAMES = { free: 'Free', pro: 'Pro', internal: 'Internal' };

// The account page's plan section (#129): the plan, what's used against its caps, and the
// Upgrade (Stripe Checkout) / Manage billing (Stripe Customer Portal) buttons. The buttons are
// hidden when the backend has no Stripe keys. `?billing=upgrade` (the pricing page's link)
// starts Checkout straight away; Stripe sends the user back with `?billing=success|cancel`.
export default {
    name: 'SubscriptionForm',

    data() {
        return {
            loading: true,
            error: null,
            status: null,
            redirecting: false,
            notice: null
        };
    },

    props: ['account'],

    computed: {
        plan_name() {
            const status = this.status;
            return (status && PLAN_NAMES[status.plan]) || 'Free';
        },
        usage_rows() {
            const s = this.status;
            if (!s || !s.limits) return [];
            return [
                { label: 'Tables', used: s.tables, max: s.limits.max_tables },
                {
                    label: 'Rows (largest table)',
                    used: s.max_table_rows,
                    max: s.limits.max_rows
                },
                {
                    label: 'API calls this month',
                    used: s.api_calls_this_month,
                    max: s.limits.max_api_calls_per_month
                }
            ];
        },
        can_upgrade() {
            const s = this.status;
            return !!(s && s.billing_enabled && s.plan === 'free');
        },
        can_manage() {
            const s = this.status;
            return !!(s && s.billing_enabled && s.has_billing_account);
        }
    },

    methods: {
        async load() {
            try {
                this.status = await billing_http.status();
                this.error = null;
            } catch (ex) {
                this.error = (ex && ex.message) || 'Could not load the plan';
            }
            this.loading = false;
        },

        async go(action) {
            this.redirecting = true;
            try {
                const res =
                    action === 'portal'
                        ? await billing_http.portal()
                        : await billing_http.checkout();
                // Stripe's pages are on another site: a full page load
                window.location.href = res.url;
            } catch (ex) {
                this.redirecting = false;
                this.error = (ex && ex.message) || 'Could not reach billing';
            }
        },

        format(n) {
            return Number(n || 0).toLocaleString();
        }
    },

    async mounted() {
        const billing = new URLSearchParams(window.location.search).get(
            'billing'
        );
        await this.load();
        if (billing === 'success') {
            this.notice =
                'Thanks! Your plan updates as soon as Stripe confirms the payment.';
            // The webhook can land a moment after Stripe redirects back
            setTimeout(() => this.load(), 4000);
        } else if (billing === 'cancel') {
            this.notice = 'Checkout was cancelled; nothing changed.';
        } else if (billing === 'upgrade' && this.can_upgrade) {
            await this.go('checkout');
        }
    }
};
