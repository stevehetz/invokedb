import { Entity, Column, PrimaryColumn } from 'typeorm';

// Stripe webhook events already handled, by event id, so a replayed or retried event is a no-op
@Entity()
export class StripeEvent {
    @PrimaryColumn()
    id: string;

    @Column()
    type: string;

    @Column({ type: 'timestamp' })
    created_datetime: Date;
}
