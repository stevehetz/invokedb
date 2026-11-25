import { http } from '@/core/http';

// The /billing endpoints (#129): the account's plan, caps and usage, and the Stripe Checkout
// and Customer Portal links. The plan itself only changes through Stripe's webhook.
export const billing_http = {
    // { billing_enabled, plan, plan_status, limits, tables, max_table_rows,
    //   api_calls_this_month, read_only, read_only_reason, has_billing_account, plans }
    status() {
        return http.get(http.get_url('/billing'));
    },

    // { url }: the Stripe Checkout page to upgrade
    checkout() {
        return http.post(http.get_url('/billing/checkout'), {});
    },

    // { url }: the Stripe Customer Portal, to manage or cancel the subscription
    portal() {
        return http.post(http.get_url('/billing/portal'), {});
    }
};
