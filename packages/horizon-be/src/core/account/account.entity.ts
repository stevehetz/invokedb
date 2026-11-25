import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { FileDirectory } from '../file-directory/file-directory.entity';

@Entity()
export class Account {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    email: string;

    // Null for an account created through Google or GitHub sign-in
    @Column({ type: 'varchar', nullable: true })
    password_hash: string | null;

    @Column()
    first_name: string;

    @Column()
    last_name: string;

    @Column()
    api_key: string;

    @Column()
    deleted: boolean;

    // Billing (#129). `plan` is 'free', 'pro' or 'internal' (core/billing/plans.ts) and is only
    // changed by Stripe webhooks (or a migration for 'internal'). A free account has no Stripe
    // customer until it starts Checkout.
    @Column({ default: 'free' })
    plan: string;

    // The Stripe subscription's status (active, past_due, canceled, ...); null on free
    @Column({ type: 'varchar', nullable: true })
    plan_status: string | null;

    // `created` (Unix seconds) of the last Stripe event applied to the plan, so an older event
    // that arrives late can't undo a newer one
    @Column({ type: 'bigint', nullable: true })
    plan_event_at: string | null;

    @Column({ type: 'varchar', nullable: true })
    stripe_customer_id: string | null;

    @Column({ type: 'varchar', nullable: true })
    stripe_subscription_id: string | null;

    // Set when the account is over its plan's table cap: it turns read-only
    @Column()
    locked: boolean;

    @Column({ type: 'varchar', nullable: true })
    locked_reason: string | null;
}
