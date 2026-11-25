import { Entity, Column, CreateDateColumn, PrimaryGeneratedColumn } from 'typeorm';
import type { ApiKeyAccess } from './api-key-rules';

// One of an account's API keys (#138). The key itself is only shown when it's made: this keeps
// its SHA-256 (key_hash) and first characters (prefix). A revoked key stays listed for
// REVOKED_KEPT_DAYS, then is deleted (#178).
@Entity()
export class ApiKey {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    account_id: number;

    @Column({ type: 'varchar' })
    name: string;

    @Column({ type: 'varchar' })
    prefix: string;

    @Column({ type: 'varchar' })
    key_hash: string;

    @Column({ type: 'varchar' })
    access: ApiKeyAccess;

    // null: every table of the account
    @Column({ type: 'int', array: true, nullable: true })
    table_ids: number[] | null;

    // The key's own request limit (#216): null for none, so only the account's limit applies.
    // A float column, which TypeORM returns as a number.
    @Column({ type: 'double precision', nullable: true })
    rate_limit_per_second: number | null;

    @Column({ type: 'int', nullable: true })
    rate_limit_burst: number | null;

    @CreateDateColumn()
    created_datetime: Date;

    @Column({ type: 'timestamp', nullable: true })
    last_used_datetime: Date | null;

    @Column({ type: 'timestamp', nullable: true })
    revoked_datetime: Date | null;
}
