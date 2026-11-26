// The Account page's plan and usage (#183): the plan's caps and how much of each the account
// uses, as meters, from GET /usage. A refusal at a cap ("plan_limit") links here. Billing
// (#129): buying a plan opens Stripe Checkout, and Manage billing the Stripe Customer Portal;
// the plan itself only changes when Stripe's webhook says so, so after Checkout the page
// checks again for a little while.
import { defineComponent } from 'vue';
import { plan_http } from '@/core/context/plan/plan-http';
import {
    USAGE_ROWS,
    bytes_label,
    count_label,
    meter
} from '@/core/context/plan/plan';

// After Checkout: how often, and how many times, to look for the new plan
const POLL_MS = 2000;
const POLL_TIMES = 15;

export default defineComponent({
    name: 'SubscriptionForm',

    props: ['account'],

    data() {
        return {
            loading: true,
            /** @type {any} */
            usage: null,
            /** @type {any} */
            billing: null,
            /** @type {any[]} */
            plans: [],
            interval: 'month',
            // The plan whose Checkout is opening, or 'portal'
            opening: '',
            billing_error: '',
            // Shown after coming back from Checkout or the Portal
            billing_note: '',
            error: '',
            account_locked: false,
            account_locked_reason: null,
            poll_timer: null
        };
    },

    computed: {
        plan_name() {
            const u = this.usage;
            if (!u) return '';
            return u.internal ? `${u.plan.name} (no caps)` : u.plan.name;
        },

        meters() {
            const u = this.usage;
            if (!u) return [];
            return USAGE_ROWS.map(row => meter(row, u.usage[row.key]));
        },

        /** @returns {any} */
        subscription() {
            return (this.billing && this.billing.subscription) || null;
        },

        /** The line under the plan's name about its subscription @returns {string} */
        subscription_note() {
            const s = this.subscription;
            if (!s) return '';
            const per = s.interval === 'year' ? 'Yearly' : 'Monthly';
            const end = date_label(s.current_period_end);
            if (s.failing) return `${per}. The last payment didn't go through.`;
            if (s.cancel_at_period_end)
                return `${per}, cancelled: ends on ${end}.`;
            return end ? `${per}, renews on ${end}.` : `${per}.`;
        },

        /** Plans that can be bought here: only while there's no subscription @returns {any[]} */
        buyable_plans() {
            const b = this.billing;
            if (!b || !b.can_buy || this.subscription) return [];
            return this.plans.filter(p => p.price_month_usd);
        },

        can_manage() {
            return !!(
                this.billing &&
                this.billing.enabled &&
                this.billing.has_billing_account
            );
        }
    },

    watch: {
        account: {
            /** @param {any} account */
            handler(account) {
                if (!account) return;
                this.account_locked = account.locked;
                this.account_locked_reason = account.locked_reason;
            },
            immediate: true
        }
    },

    async mounted() {
        await this.load();
        await this.after_redirect();
    },

    beforeUnmount() {
        if (this.poll_timer) clearTimeout(this.poll_timer);
    },

    methods: {
        count_label,
        bytes_label,

        async load() {
            try {
                const [usage, billing, plans] = await Promise.all([
                    plan_http.usage(),
                    plan_http.billing().catch(() => null),
                    plan_http.plans().catch(() => null)
                ]);
                this.usage = usage;
                this.billing = billing;
                this.plans = (plans && plans.plans) || [];
                this.error = '';
            } catch (ex) {
                this.error =
                    (ex && ex.message) || "Your usage couldn't be loaded.";
            } finally {
                this.loading = false;
            }
        },

        /** `?billing=` from Stripe sending the user back; `?upgrade=` from the pricing page */
        async after_redirect() {
            const query = (this.$route && this.$route.query) || {};
            const billing = String(query.billing || '');
            const upgrade = String(query.upgrade || '').toUpperCase();
            if (!billing && !upgrade) return;
            const rest = { ...query };
            delete rest.billing;
            delete rest.upgrade;
            delete rest.interval;
            this.$router.replace({ query: rest });

            if (billing === 'success') {
                // The webhook often lands before the page loads
                if (this.subscription) {
                    this.billing_note = `Thanks! You're on ${this.usage.plan.name} now.`;
                } else {
                    this.billing_note =
                        'Thanks! Your new plan shows here as soon as Stripe confirms the payment.';
                    this.poll_for_plan(POLL_TIMES);
                }
            } else if (billing === 'cancel') {
                this.billing_note =
                    'Checkout was cancelled: nothing was charged.';
            } else if (
                upgrade &&
                this.buyable_plans.some(p => p.id === upgrade)
            ) {
                if (query.interval === 'year') this.interval = 'year';
                await this.checkout(upgrade);
            }
        },

        /** Loads the plan again until the subscription shows (the webhook has landed) */
        poll_for_plan(times) {
            if (times <= 0) {
                this.billing_note =
                    'Stripe has the payment, but it hasn’t reached us yet: reload this page in a minute.';
                return;
            }
            this.poll_timer = setTimeout(async () => {
                await this.load();
                if (this.subscription) {
                    this.billing_note = `Thanks! You're on ${this.usage.plan.name} now.`;
                    return;
                }
                this.poll_for_plan(times - 1);
            }, POLL_MS);
        },

        /** @param {any} plan */
        price(plan) {
            return this.interval === 'year'
                ? `$${plan.price_year_usd}/year`
                : `$${plan.price_month_usd}/month`;
        },

        /** Opens Stripe Checkout for a plan @param {string} plan_id */
        async checkout(plan_id) {
            this.opening = plan_id;
            this.billing_error = '';
            try {
                const res = await plan_http.checkout(plan_id, this.interval);
                window.location.assign(res.url);
            } catch (ex) {
                this.opening = '';
                this.billing_error =
                    (ex && ex.message) || "Checkout couldn't be opened.";
            }
        },

        async manage() {
            this.opening = 'portal';
            this.billing_error = '';
            try {
                const res = await plan_http.portal();
                window.location.assign(res.url);
            } catch (ex) {
                this.opening = '';
                this.billing_error =
                    (ex && ex.message) || "Billing couldn't be opened.";
            }
        }
    }
});

/** A Stripe time (Unix seconds) as "Dec 26, 2026" @param {number|null} seconds */
function date_label(seconds) {
    if (!seconds) return '';
    return new Date(seconds * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}
