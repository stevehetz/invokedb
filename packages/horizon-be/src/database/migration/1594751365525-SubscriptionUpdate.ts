import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionUpdate1594751365525 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            UPDATE subscription
            SET max_rows = '10000',
                max_requests_per_minute = '50'
            WHERE id = 'SUB_FREE';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            UPDATE subscription
            SET max_rows = '100000',
                max_requests_per_minute = '5'
            WHERE id = 'SUB_FREE';
        `);
    }
}
