import Stripe from 'stripe';
import env from '@app/env';

// The Stripe API client (#129), or null when STRIPE_SECRET_KEY isn't set (billing is then off).
// A Nest provider, so the unit tests hand BillingService a fake instead. STRIPE_API_BASE (test
// only) points it at api-smoke.mjs's stub.
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export function make_stripe_client(
    key: string | undefined = env.STRIPE_SECRET_KEY,
    base: string | undefined = env.STRIPE_API_BASE
): Stripe | null {
    if (!key) return null;
    const config: Stripe.StripeConfig = { maxNetworkRetries: 2, timeout: 20000 };
    if (base) {
        const url = new URL(base);
        config.host = url.hostname;
        config.port = url.port || (url.protocol === 'https:' ? 443 : 80);
        config.protocol = url.protocol === 'https:' ? 'https' : 'http';
    }
    return new Stripe(key, config);
}

export const stripe_client_provider = {
    provide: STRIPE_CLIENT,
    useFactory: (): Stripe | null => make_stripe_client()
};
