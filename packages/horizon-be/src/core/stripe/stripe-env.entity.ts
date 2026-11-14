import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class StripeEnv {
    @PrimaryColumn()
    id: string;

    @Column()
    stripe_account_type: string;

    @Column()
    stripe_account_public_key: string;

    @Column()
    stripe_account_secret_key: string;
}
