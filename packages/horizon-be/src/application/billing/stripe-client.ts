import Stripe from 'stripe';
import env from '@app/env';

// The Stripe API client, or null when STRIPE_SECRET_KEY isn't set (billing is then off). A Nest
// provider, so the unit tests can hand BillingService a fake instead.
export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export const stripe_client_provider = {
    provide: STRIPE_CLIENT,
    useFactory: (): Stripe | null =>
        env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null
};
