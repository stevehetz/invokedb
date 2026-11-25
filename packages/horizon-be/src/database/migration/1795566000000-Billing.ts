import { MigrationInterface, QueryRunner } from 'typeorm';

// Billing through Stripe (#129). The plan now lives on the account (`plan`, `plan_status`) and
// its caps in code (core/billing/plans.ts), so the 2020 `subscription` and `stripe_env` tables
// (old Stripe keys and products) and the account's `subscription_id` / `stripe_env_id` go.
// `stripe_event` records the webhook events already handled.
//
// Existing accounts: everyone starts on 'free', except
// - accounts that had a paid 2020 subscription keep paid caps ('pro', status 'legacy', no
//   Stripe subscription), so nobody loses access; the owner decides what happens to them
// - the demo accounts and the production E2E test account, which get 'internal' (never capped
//   by the free tier, so the smoke and E2E tests keep working)
export class Billing1795566000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE account
                ADD COLUMN plan VARCHAR (20) NOT NULL DEFAULT 'free',
                ADD COLUMN plan_status VARCHAR (30),
                ADD COLUMN plan_event_at BIGINT
        `);
        await queryRunner.query(`
            UPDATE account SET plan = 'pro', plan_status = 'legacy'
            WHERE subscription_id IS NOT NULL AND subscription_id <> 'SUB_FREE'
        `);
        await queryRunner.query(`
            UPDATE account SET plan = 'internal', plan_status = NULL
            WHERE email ~ '^demo[0-9]*@invokedb\\.com$' OR email = 'e2e@invokedb.com'
        `);
        // The old Stripe ids belong to the retired 2020 Stripe account
        await queryRunner.query(
            `UPDATE account SET stripe_customer_id = NULL, stripe_subscription_id = NULL`
        );
        await queryRunner.query(`
            ALTER TABLE account
                DROP COLUMN subscription_id,
                DROP COLUMN stripe_env_id
        `);
        await queryRunner.query(`DROP TABLE subscription`);
        await queryRunner.query(`DROP TABLE stripe_env`);
        await queryRunner.query(
            `CREATE INDEX account_stripe_customer_id ON account (stripe_customer_id)`
        );
        await queryRunner.query(`
            CREATE TABLE stripe_event (
                id VARCHAR (255) PRIMARY KEY,
                type VARCHAR (100) NOT NULL,
                created_datetime TIMESTAMP NOT NULL DEFAULT current_timestamp
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE stripe_event`);
        await queryRunner.query(`DROP INDEX account_stripe_customer_id`);
        await queryRunner.query(`
            CREATE TABLE stripe_env (
                id VARCHAR (50) PRIMARY KEY,
                stripe_account_type VARCHAR (20),
                stripe_account_public_key VARCHAR (150),
                stripe_account_secret_key VARCHAR (150)
            )
        `);
        await queryRunner.query(`
            CREATE TABLE subscription (
                id VARCHAR (50) PRIMARY KEY,
                name VARCHAR (100),
                stripe_product_id VARCHAR (100),
                stripe_plan_id VARCHAR (100),
                stripe_env_id VARCHAR (50),
                price DECIMAL,
                max_tables INT,
                max_rows INT,
                max_requests_per_minute INT,
                enabled BOOLEAN
            )
        `);
        await queryRunner.query(`
            INSERT INTO subscription
                (id, name, price, max_tables, max_rows, max_requests_per_minute, enabled)
            VALUES ('SUB_FREE', 'Free', 0, 3, 150000, 5, true)
        `);
        await queryRunner.query(`
            ALTER TABLE account
                ADD COLUMN subscription_id VARCHAR (50) references subscription(id),
                ADD COLUMN stripe_env_id VARCHAR (50) DEFAULT 'STRIPE_ENV_LIVE'
        `);
        await queryRunner.query(`
            ALTER TABLE account
                DROP COLUMN plan,
                DROP COLUMN plan_status,
                DROP COLUMN plan_event_at
        `);
    }
}
