import { Entity, Column, PrimaryColumn } from 'typeorm';

// An account's two-factor sign-in (#214). A row with `enabled` false is a setup the owner
// hasn't confirmed with a code yet; it does nothing at login.
@Entity('two_factor')
export class TwoFactor {
    @PrimaryColumn()
    account_id: number;

    // The TOTP secret, encrypted (core/two-factor/totp.ts, encrypt_secret)
    @Column({ type: 'text' })
    secret_encrypted: string;

    @Column({ type: 'boolean', default: false })
    enabled: boolean;

    // The last time step a code was accepted for; codes for it or earlier are refused (replay)
    @Column({
        type: 'bigint',
        nullable: true,
        transformer: {
            to: (value: number | null) => value,
            from: (value: string | null) => (value === null ? null : Number(value))
        }
    })
    last_used_step: number | null;

    // SHA-256 (hex) of each unused recovery code; a used one is removed
    @Column({ type: 'text', array: true, default: () => "'{}'" })
    recovery_code_hashes: string[];

    @Column({ type: 'timestamp', default: () => 'current_timestamp' })
    created_datetime: Date;

    @Column({ type: 'timestamp', nullable: true })
    enabled_datetime: Date | null;
}
