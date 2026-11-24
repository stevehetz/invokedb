import { http } from '@/core/http';

export const subscription_http = {
    async get_stripe_subscription() {
        const url = http.get_url('/subscription/stripe-subscription');
        return http.get(url);
    },

    async create(data) {
        const url = http.get_url('/subscription/create');
        return http.post(url, data);
    },

    async get_plan_tiers() {
        return http.get(http.get_url('/subscription/plan-tiers'));
    },

    async get_billing_portal(data) {
        return http.post(http.get_url('/subscription/billing-portal'), data);
    },

    async get_stripe_pk() {
        return http.get(http.get_url('/stripe/pk'));
    }
};
