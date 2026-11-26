import { MigrationInterface, QueryRunner } from 'typeorm';

// Stripe billing (#129): the webhook events already handled, and an index to find an account by
// its Stripe customer. The Stripe ids left from 2020 belong to an old Stripe account that's no
// longer used, so they're cleared: a new customer is made at the first Checkout.
export class StripeBilling1796000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS stripe_event (
                id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(100) NOT NULL,
                created_datetime TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(
            `UPDATE account SET stripe_customer_id = NULL, stripe_subscription_id = NULL
             WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL`
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS account_stripe_customer_id_idx
             ON account (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS account_stripe_customer_id_idx`);
        await queryRunner.query(`DROP TABLE IF EXISTS stripe_event`);
    }
}
