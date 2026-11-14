import { MigrationInterface, QueryRunner } from 'typeorm';

export class TestData1597425646191 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        // Test Data
        queryRunner.query(`
            INSERT INTO account (
                email,
                subscription_id,
                stripe_customer_id,
                stripe_subscription_id,
                password_hash,
                first_name,
                last_name,
                api_key,
                deleted,
                locked,
                locked_reason,
                stripe_env_id
            )
            VALUES
                ('demo2@invokedb.com',
                NULL,
                NULL,
                NULL,
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Test',
                'User',
                'vvdKSwT7X1mnhHrDDDeUC8aFGLrM0u35',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_TEST'),
                ('demo3@invokedb.com',
                NULL,
                NULL,
                NULL,
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Test',
                'User',
                'vvdKSwT7X1mnhHrDDDeUC8aFGLrM0u34',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_TEST'),
                ('demo4@invokedb.com',
                NULL,
                NULL,
                NULL,
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Test',
                'User',
                'vvdKSwT7X1mnhHrDDDeUC8aFGLrM0u33',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_TEST'),
                ('demo5@invokedb.com',
                NULL,
                NULL,
                NULL,
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Test',
                'User',
                'vvdKSwT7X1mnhHrDDDeUC8aFGLrM0u32',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_TEST'),
                ('demo6@invokedb.com',
                NULL,
                NULL,
                NULL,
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Test',
                'User',
                'vvdKSwT7X1mnhHrDDDeUC8aFGLrM0u31',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_TEST'),
                ('demo7@invokedb.com',
                NULL,
                NULL,
                NULL,
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Test',
                'User',
                'vvdKSwT7X1mnhHrDDDeUC8aFGLrM0u30',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_TEST');
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            DELETE FROM session;

            DELETE FROM account
            WHERE email = 'demo2@invokedb.com';

            DELETE FROM account
            WHERE email = 'demo3@invokedb.com';

            DELETE FROM account
            WHERE email = 'demo4@invokedb.com';

            DELETE FROM account
            WHERE email = 'demo5@invokedb.com';

            DELETE FROM account
            WHERE email = 'demo6@invokedb.com';

            DELETE FROM account
            WHERE email = 'demo7@invokedb.com';
        `);
    }
}
