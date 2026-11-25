import { MigrationInterface, QueryRunner } from 'typeorm';

// Optional two-factor sign-in (#214): one row per account that has set it up. The TOTP secret is
// encrypted with the server's HORIZON_TOTP_KEY; recovery codes are kept as SHA-256 hashes.
export class TwoFactor1795720000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE two_factor (
                account_id INT PRIMARY KEY references account(id) ON DELETE CASCADE,
                secret_encrypted TEXT NOT NULL,
                enabled BOOLEAN NOT NULL DEFAULT false,
                last_used_step BIGINT,
                recovery_code_hashes TEXT[] NOT NULL DEFAULT '{}',
                created_datetime TIMESTAMP NOT NULL DEFAULT current_timestamp,
                enabled_datetime TIMESTAMP
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE two_factor`);
    }
}
