import { Contains } from 'class-validator';

export class AccountUpdateDto {
    @Contains('')
    first_name: string;

    @Contains('')
    last_name: string;

    subscription_id: string;

    stripe_customer_id: string;

    stripe_subscription_id: string;
}
