import { MigrationInterface, QueryRunner } from 'typeorm';

// Email verification on signup (#132). Every account that exists now (password, Google or GitHub)
// counts as verified; new password accounts start unverified, so the column's default becomes
// false once the existing rows are filled in. A verification link is a row of
// email_verification and expires after 24 hours.
export class EmailVerification1795581569204 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE account ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT TRUE`
        );
        await queryRunner.query(
            `ALTER TABLE account ALTER COLUMN email_verified SET DEFAULT FALSE`
        );
        await queryRunner.query(`
            CREATE TABLE email_verification (
                token uuid PRIMARY KEY,
                account_id INT NOT NULL references account(id),
                expired_datetime TIMESTAMP DEFAULT current_timestamp + INTERVAL '24 HOURS'
            )
        `);
        await queryRunner.query(
            `CREATE INDEX email_verification_account_id ON email_verification (account_id)`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE email_verification`);
        await queryRunner.query(`ALTER TABLE account DROP COLUMN email_verified`);
    }
}
