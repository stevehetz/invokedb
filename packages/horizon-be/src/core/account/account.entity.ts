import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { FileDirectory } from '../file-directory/file-directory.entity';
import type { ApiKeyScope } from '../api-key/api-key-rules';

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
