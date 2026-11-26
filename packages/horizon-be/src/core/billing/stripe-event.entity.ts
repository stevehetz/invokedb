import { Entity, Column, PrimaryColumn } from 'typeorm';

// A Stripe webhook event already handled (#129), by its id, so a redelivery does nothing
@Entity()
export class StripeEvent {
    // Stripe's `evt_...`
    @PrimaryColumn({ type: 'varchar', length: 255 })
    id: string;

    @Column({ type: 'varchar', length: 100 })
    type: string;

    @Column({ type: 'timestamptz', default: () => 'now()' })
    created_datetime: Date;
}
