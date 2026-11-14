import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubscriptionUpdate21597933226910 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            UPDATE subscription
            SET max_rows = '150000'
            WHERE id = 'SUB_FREE';

            UPDATE subscription
            SET max_rows = '500000'
            WHERE id = 'SUB_TEST_BASIC' OR id = 'SUB_LIVE_BASIC';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            UPDATE subscription
            SET max_rows = '10000'
            WHERE id = 'SUB_FREE';

            UPDATE subscription
            SET max_rows = '100000'
            WHERE id = 'SUB_TEST_BASIC' OR id = 'SUB_LIVE_BASIC';
        `);
    }
}
