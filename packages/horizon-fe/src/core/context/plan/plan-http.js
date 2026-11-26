import { http } from '@/core/http';

// The plans and an account's use of them (#183). The backend's plan constant
// (core/plan/plans.ts) is the one source of every cap: the pricing page and the Account page
// only show what these answer.
export const plan_http = {
    /** The signed-in account's plan, each cap and how much of it is used */
    async usage() {
        return http.get(http.get_url('/usage'));
    },

    /**
     * Billing (#129): whether it's on, and the account's Stripe subscription
     * `{ enabled, plan, can_buy, has_billing_account, subscription }`
     */
    async billing() {
        return http.get(http.get_url('/billing'));
    },

    /**
     * A Stripe Checkout page for a plan: `{ url }`
     * @param {string} plan STARTER or PRO
     * @param {string} interval month or year
     */
    async checkout(plan, interval) {
        return http.post(http.get_url('/billing/checkout'), { plan, interval });
    },

    /** The Stripe Customer Portal (change plan, cancel, card, invoices): `{ url }` */
    async portal() {
        return http.post(http.get_url('/billing/portal'), {});
    },

    /** The plans, public (no token): `{ plans, server_max_upload_bytes }` */
    async plans() {
        const res = await fetch(http.get_url('/plans'));
        if (!res.ok)
            throw { status: res.status, message: 'Could not load the plans' };
        return res.json();
    }
};
