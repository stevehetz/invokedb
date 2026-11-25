import { MigrationInterface, QueryRunner } from 'typeorm';

// An optional request limit per API key (#216), set when the key is made: requests per second
// (may be a fraction) and the burst allowed. Existing keys get none, so they keep only the
// account's per-minute limit. The keys' request logs are in Mongo (tracking:api_key_request).
export class ApiKeyRateLimit1795700000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE api_key ADD COLUMN rate_limit_per_second DOUBLE PRECISION`
        );
        await queryRunner.query(`ALTER TABLE api_key ADD COLUMN rate_limit_burst INT`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE api_key DROP COLUMN rate_limit_burst`);
        await queryRunner.query(`ALTER TABLE api_key DROP COLUMN rate_limit_per_second`);
    }
}
