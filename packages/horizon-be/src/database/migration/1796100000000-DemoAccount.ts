import { MigrationInterface, QueryRunner } from 'typeorm';

// The no-signup demo (#333): a demo account has the time it's deleted; every other account
// null. The index serves the live count and the processor's hourly sweep.
export class DemoAccount1796100000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE account ADD COLUMN IF NOT EXISTS demo_expires_at TIMESTAMPTZ NULL`
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS account_demo_expires_at_idx
             ON account (demo_expires_at) WHERE demo_expires_at IS NOT NULL`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS account_demo_expires_at_idx`);
        await queryRunner.query(`ALTER TABLE account DROP COLUMN IF EXISTS demo_expires_at`);
    }
}
