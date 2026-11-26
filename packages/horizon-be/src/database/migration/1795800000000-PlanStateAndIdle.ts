import { MigrationInterface, QueryRunner } from 'typeorm';

// #184 (docs/PRICING.md 3.4). The account's plan state, separate from `locked`: 'active',
// 'grace' (a failed payment: full access until grace_ends_at) or 'read_only' (over its plan's
// caps). And what the idle rule for free accounts needs: the last sign-in and API call, when the
// idle clock last started over without either (signup; for older accounts, this migration), and
// when the two warnings went out.
export class PlanStateAndIdle1795800000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE account
                ADD COLUMN plan_state VARCHAR(16) NOT NULL DEFAULT 'active',
                ADD COLUMN grace_ends_at TIMESTAMPTZ,
                ADD COLUMN last_sign_in_at TIMESTAMPTZ,
                ADD COLUMN last_api_call_at TIMESTAMPTZ,
                ADD COLUMN idle_clock_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                ADD COLUMN idle_warned_at TIMESTAMPTZ,
                ADD COLUMN idle_final_warned_at TIMESTAMPTZ
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE account
                DROP COLUMN plan_state,
                DROP COLUMN grace_ends_at,
                DROP COLUMN last_sign_in_at,
                DROP COLUMN last_api_call_at,
                DROP COLUMN idle_clock_at,
                DROP COLUMN idle_warned_at,
                DROP COLUMN idle_final_warned_at
        `);
    }
}
