import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class Subscription {
    @PrimaryColumn()
    id: string;

    @Column()
    name: string;

    @Column()
    stripe_product_id: string;

    @Column()
    stripe_plan_id: string;

    @Column()
    stripe_env_id: string;

    // Postgres DECIMAL comes back as a string (e.g. "99.99"); a bare number column would be parseInt-ed
    @Column({ type: 'decimal' })
    price: string;

    @Column()
    max_tables: number;

    @Column()
    max_rows: number;

    @Column()
    max_requests_per_minute: number;

    @Column()
    enabled: boolean;
}
