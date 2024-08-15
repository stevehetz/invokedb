import { http } from '@/core/http';

export const subscription_http = {
    async get_stripe_subscription() {
        const url = http.get_url('/subscription/stripe-subscription');
        return http.get(url);
    },

    async create(data) {
        const url = http.get_url('/subscription/create');
        return http.post(url, data);
    }
};
