import { MigrationInterface, QueryRunner } from 'typeorm';

// Google and GitHub sign-in (#17): the logins linked to each account, and accounts created
// through one have no password.
export class AccountIdentity1795540596824 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE account_identity (
                id SERIAL PRIMARY KEY,
                provider VARCHAR (20) NOT NULL,
                provider_user_id VARCHAR (100) NOT NULL,
                account_id INT NOT NULL references account(id),
                created_datetime TIMESTAMP DEFAULT current_timestamp,
                UNIQUE (provider, provider_user_id)
            )
        `);
        await queryRunner.query(
            `CREATE INDEX account_identity_account_id ON account_identity (account_id)`
        );
        await queryRunner.query(`ALTER TABLE account ALTER COLUMN password_hash DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Accounts without a password get a value no password matches (not a bcrypt hash),
        // so the NOT NULL can come back. Those accounts can still use "Forgot password".
        await queryRunner.query(
            `UPDATE account SET password_hash = '!' WHERE password_hash IS NULL`
        );
        await queryRunner.query(`ALTER TABLE account ALTER COLUMN password_hash SET NOT NULL`);
        await queryRunner.query(`DROP TABLE account_identity`);
    }
}
