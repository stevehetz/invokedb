import { MigrationInterface, QueryRunner } from 'typeorm';

// The admin area (#277). `created_datetime`: when the account was made (sign-ups per day, the
// accounts list); accounts from before this migration have none, since nothing recorded it.
// `internal`: an admin put the account on no counted caps, like the INTERNAL_EMAILS (#183),
// until Stripe (#129) has plans of its own.
export class AdminArea1795800000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE account ADD COLUMN created_datetime TIMESTAMP`);
        await queryRunner.query(
            `ALTER TABLE account ALTER COLUMN created_datetime SET DEFAULT current_timestamp`
        );
        await queryRunner.query(
            `ALTER TABLE account ADD COLUMN internal BOOLEAN NOT NULL DEFAULT false`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE account DROP COLUMN internal`);
        await queryRunner.query(`ALTER TABLE account DROP COLUMN created_datetime`);
    }
}
