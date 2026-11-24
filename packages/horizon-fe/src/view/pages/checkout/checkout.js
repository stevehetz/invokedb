// @ts-nocheck: not type-checked yet
import SubscriptionHttp from '@/network/http/subscription/subscription-http';
import StripeHttp from '@/network/http/stripe/stripe-http';
import { store } from '@/store';

const subscription_http = new SubscriptionHttp();
const stripe_http = new StripeHttp();
const { Stripe } = window;

export default {
    name: 'Checkout',

    data() {
        return {
            stripe: null,
            account: null,
            loading: true,
            processing: false,
            selected_tier: null,
            plan_tiers: [],
            error: {
                message: ''
            },
            stripe_styles: {
                base: {
                    color: '#32325d',
                    fontFamily: '"Helvetica Neue", Helvetica, sans-serif',
                    fontSmoothing: 'antialiased',
                    fontSize: '16px',
                    '::placeholder': {
                        color: '#aab7c4'
                    }
                },
                invalid: {
                    color: '#fa755a',
                    iconColor: '#fa755a'
                }
            },
            card_element: null
        };
    },

    async mounted() {
        if (this.$route.query.existing_plan === 'true') {
            await this.go_to_stripe_portal();
        } else {
            this.get_account();
        }
    },

    methods: {
        async go_to_stripe_portal() {
            const res = await subscription_http.get_billing_portal({
                return_url: window.location.origin + '/app/account'
            });
            window.location.href = res.url;
        },

        go_to_database(e) {
            e.preventDefault();
            window.location.href = '/app';
        },

        get_account() {
            store.subscribe('account', async account => {
                this.account = account;
                if (!this.account) {
                    this.$router.push('/login');
                } else {
                    this.loading = false;
                    await this.get_plan_tiers();
                    const stripe_pk = await stripe_http.get_stripe_pk();
                    this.stripe = Stripe(stripe_pk);
                    this.init_stripe();
                }
            });
        },

        async get_plan_tiers() {
            const tiers = await subscription_http.get_plan_tiers();
            this.plan_tiers = tiers.map(tier => ({
                id: tier.id,
                name: `${tier.name} - $${tier.price}/mo`
            }));
            this.selected_tier = this.plan_tiers[0].id;
        },

        async submit(e) {
            e.preventDefault();
            this.$refs.submit_payment.click();
        },

        init_stripe() {
            const elements = this.stripe.elements();
            this.card_element = elements.create('card', {
                style: this.stripe_styles
            });
            this.card_element.mount('#card-element');
            this.card_element.addEventListener('change', function (event) {
                const display_error = document.getElementById('card-errors');
                if (event.error) {
                    display_error.textContent = event.error.message;
                } else {
                    display_error.textContent = '';
                }
            });

            const form = document.getElementById('subscription-form');
            form.addEventListener('submit', event =>
                this.stripe_form_submit(event)
            );
        },

        stripe_form_submit(event) {
            event.preventDefault();
            if (this.processing) return;
            this.processing = true;
            this.clear_error();

            this.stripe
                .createPaymentMethod({
                    type: 'card',
                    card: this.card_element,
                    billing_details: {
                        email: this.account.email
                    }
                })
                .then(result => this.stripe_payment_handler(result));
        },

        stripe_payment_handler(result) {
            if (result.error) {
                console.log('error submitting payment');
                this.set_error(
                    result.error,
                    'There was an error submitting your payment'
                );
                return;
            }

            subscription_http
                .create({
                    email: this.account.email,
                    payment_method: result.paymentMethod.id,
                    subscription_id: this.selected_tier
                })
                .then(
                    res => this.stripe_subscription_success(res),
                    err => this.stripe_subscription_error(err)
                );
        },

        stripe_subscription_success(subscription) {
            const { latest_invoice } = subscription;
            const { payment_intent } = latest_invoice;

            if (payment_intent) {
                const { client_secret, status } = payment_intent;

                if (status === 'requires_action') {
                    this.stripe
                        .confirmCardPayment(client_secret)
                        .then(result =>
                            this.stripe_card_confirm_handler(result)
                        );
                } else {
                    this.on_payment_success();
                }
            } else {
                this.on_payment_success();
            }
        },

        stripe_subscription_error(error) {
            console.log('error creating subscription');
            this.set_error(
                error,
                'There was an error creating your subscription'
            );
        },

        stripe_card_confirm_handler(result) {
            if (result.error) {
                console.log('error confirming card payment');
                this.set_error(result.error, 'Error confirming card payment');
            } else {
                this.on_payment_success();
            }
        },

        on_payment_success() {
            window.location.href = '/app/account';
        },

        set_error(error, default_msg) {
            let msg = default_msg;
            if (typeof error === 'string') {
                msg = error;
            } else if (error.message && typeof error.message === 'string') {
                msg = error.message;
            }

            const display_error = document.getElementById('card-errors');
            display_error.textContent = msg;
            this.processing = false;
        },

        clear_error() {
            const display_error = document.getElementById('card-errors');
            display_error.textContent = '';
        }
    }
};
