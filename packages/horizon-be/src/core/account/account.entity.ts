import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { FileDirectory } from '../file-directory/file-directory.entity';
import type { ApiKeyScope } from '../api-key/api-key-rules';
import type { PlanState } from '../plan/plan-state';

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
    subscription_id: string;

    @Column()
    deleted: boolean;

    @Column()
    stripe_customer_id: string;

    @Column()
    stripe_subscription_id: string;

    @Column()
    locked: boolean;

    @Column()
    locked_reason: string;

    @Column()
    stripe_env_id: string;

    // Not a column: set by the bearer strategy on the account an /api/v1 key belongs to, with
    // what that key may do (#138). The keys themselves are in `api_key` (ApiKey).
    key_scope?: ApiKeyScope;

    // False for a password account until its owner clicks the link in the verification email
    // (#132). Google and GitHub accounts, and accounts from before #132, are verified.
    @Column({ type: 'boolean', default: false })
    email_verified: boolean;

    // The plan state (#184, core/plan/plan-state.ts), separate from `locked`: 'active', 'grace'
    // (a failed payment: full access until grace_ends_at) or 'read_only' (over the plan's caps)
    @Column({ type: 'varchar', length: 16, default: 'active' })
    plan_state: PlanState;

    @Column({ type: 'timestamptz', nullable: true })
    grace_ends_at: Date | null;

    // The idle rule for free accounts (#184, core/plan/idle.ts)
    @Column({ type: 'timestamptz', nullable: true })
    last_sign_in_at: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    last_api_call_at: Date | null;

    // When the idle clock last started over without a sign-in or an API call: the signup (for
    // accounts from before #184, its migration), or a lapse to Free
    @Column({ type: 'timestamptz', default: () => 'now()' })
    idle_clock_at: Date;

    @Column({ type: 'timestamptz', nullable: true })
    idle_warned_at: Date | null;

    @Column({ type: 'timestamptz', nullable: true })
    idle_final_warned_at: Date | null;

    // When the account was made (#277); null for accounts from before that was recorded
    @Column({ type: 'timestamp', nullable: true, default: () => 'current_timestamp' })
    created_datetime: Date | null;

    // Put on no counted caps by an admin (#277), like the INTERNAL_EMAILS (core/plan/plans.ts)
    @Column({ type: 'boolean', default: false })
    internal: boolean;

    // The app's colour theme (#290): 'system', 'light' or 'dark' (core/theme/theme.ts)
    @Column({ type: 'varchar', length: 10, default: 'system' })
    theme: string;
}
