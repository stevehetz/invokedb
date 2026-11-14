import { MigrationInterface, QueryRunner } from 'typeorm';

export class DemoSubscription1595764338072 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            UPDATE account
            SET subscription_id = 'SUB_TEST_PREMIUM'
            WHERE email = 'demo@invokedb.com';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            UPDATE account
            SET subscription_id = NULL
            WHERE email = 'demo@invokedb.com';
        `);
    }
}
