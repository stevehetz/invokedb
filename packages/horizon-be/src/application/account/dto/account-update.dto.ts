import { Contains } from 'class-validator';

export class AccountUpdateDto {
    @Contains('')
    first_name: string;

    @Contains('')
    last_name: string;

    subscription_id: string;
}
