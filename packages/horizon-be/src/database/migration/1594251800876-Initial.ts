import { MigrationInterface, QueryRunner } from 'typeorm';

export class Initial1594251800876 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        // Create Tables
        queryRunner.query(`
            SET statement_timeout = 0;
            SET lock_timeout = 0;
            SET client_encoding = 'UTF8';
            SET standard_conforming_strings = on;
            SET check_function_bodies = false;
            SET client_min_messages = warning;
            SET row_security = off;


            CREATE TABLE stripe_env (
                id VARCHAR (50) PRIMARY KEY,
                stripe_account_type VARCHAR (20),
                stripe_account_public_key VARCHAR (150),
                stripe_account_secret_key VARCHAR (150)
            );

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
            );

            CREATE TABLE account (
                id SERIAL PRIMARY KEY,
                email VARCHAR (50) NOT NULL,
                subscription_id VARCHAR (50) references subscription(id),
                stripe_customer_id VARCHAR (100),
                stripe_subscription_id VARCHAR (100),
                password_hash VARCHAR (100) NOT NULL,
                first_name VARCHAR (100),
                last_name VARCHAR (100),
                api_key VARCHAR (32),
                deleted BOOLEAN NOT NULL DEFAULT FALSE,
                locked BOOLEAN,
                locked_reason VARCHAR (150),
                stripe_env_id VARCHAR (50) DEFAULT 'STRIPE_ENV_LIVE'
            );

            CREATE TABLE session (
                token uuid PRIMARY KEY,
                account_id INT NOT NULL references account(id),
                created_datetime TIMESTAMP DEFAULT current_timestamp,
                expired_datetime TIMESTAMP DEFAULT current_timestamp + INTERVAL '30 DAYS'
            );

            CREATE TABLE reset_password (
                token uuid PRIMARY KEY,
                account_id INT NOT NULL references account(id),
                expired_datetime TIMESTAMP DEFAULT current_timestamp + INTERVAL '1 HOUR'
            );

            CREATE TABLE file_directory (
                id SERIAL PRIMARY KEY,
                account_id INT NOT NULL references account(id),
                name VARCHAR(100),
                type VARCHAR(10),
                web_file_type VARCHAR(50),
                parent_id INT,
                raw_file_id INT,
                deleted BOOLEAN NOT NULL DEFAULT FALSE,
                locked BOOLEAN DEFAULT FALSE,
                locked_reason VARCHAR(150)
            );

            CREATE INDEX idx_file_name ON file_directory (name);
        `);

        // Seed Data
        queryRunner.query(`
            INSERT INTO stripe_env (
                id,
                stripe_account_type,
                stripe_account_public_key,
                stripe_account_secret_key
            )
            VALUES
                ('STRIPE_ENV_TEST', 'Test', '${process.env.STRIPE_TEST_PUBLIC_KEY ?? ''}', '${process.env.STRIPE_TEST_SECRET_KEY ?? ''}'),
                ('STRIPE_ENV_LIVE', 'Live', '${process.env.STRIPE_LIVE_PUBLIC_KEY ?? ''}', '${process.env.STRIPE_LIVE_SECRET_KEY ?? ''}');

            INSERT INTO subscription (
                id,
                stripe_env_id,
                name,
                stripe_product_id,
                stripe_plan_id,
                price,
                max_tables,
                max_rows,
                max_requests_per_minute,
                enabled
            )
            VALUES
                ('SUB_FREE',         NULL,              'Free',              NULL,                  NULL,                   0,      3,    10,       5,   true),
                ('SUB_TEST_BASIC',   'STRIPE_ENV_TEST', 'InvokeDB Basic',    'prod_HNbKRiL51n7SuO', 'price_HNbKvwBhTAcLvg', 4.99,   10,   10000,   1000, true),
                ('SUB_TEST_PLUS',    'STRIPE_ENV_TEST', 'InvokeDB Plus',     'prod_HNbTkSxEdjHnun', 'price_HNbTwTY5sUFr78', 9.99,   100,  100000,   NULL, true),
                ('SUB_TEST_PREMIUM', 'STRIPE_ENV_TEST', 'InvokeDB Premium',  'prod_HNbcc1hfXqbhI9', 'price_HNbcWwhqMVb3UG', 19.99,  1000, 1000000,  NULL, true),
                ('SUB_LIVE_BASIC',   'STRIPE_ENV_LIVE', 'InvokeDB Basic',    'prod_HNaZClOrTWCB9R', 'price_HNaZ4ztnAjpU58', 4.99,   10,   10000,    1000, true),
                ('SUB_LIVE_PLUS',    'STRIPE_ENV_LIVE', 'InvokeDB Plus',     'prod_HNbd7OVoL1BPcO', 'price_HNbdbcsg0SPgVU', 9.99,   100,  100000,   NULL, true),
                ('SUB_LIVE_PREMIUM', 'STRIPE_ENV_LIVE', 'InvokeDB Premium',  'prod_HNbfwRwp1fRMzg', 'price_HNbf6nVkkM9ADE', 19.99,  1000, 1000000,  NULL, true);

            UPDATE subscription
            SET max_rows                = '100000'
            WHERE id = 'SUB_FREE';

            UPDATE subscription
            SET stripe_plan_id          = 'price_1GwSz0LcMbEgBKM58qGTKK0f',
                price                   = '9.99',
                max_tables              = '50',
                max_rows                = '100000'
            WHERE id = 'SUB_TEST_BASIC';

            UPDATE subscription
            SET stripe_plan_id          = 'price_1GwSykLcMbEgBKM5U9N7ewDZ',
                price                   = '29.99',
                max_tables              = '200',
                max_rows                = '1000000',
                max_requests_per_minute = '10000'
            WHERE id = 'SUB_TEST_PLUS';

            UPDATE subscription
            SET stripe_plan_id          = 'price_1GwSyPLcMbEgBKM5qqJtFJxD',
                price                   = '99.99',
                max_tables              = '5000',
                max_rows                = '10000000',
                max_requests_per_minute = '100000'
            WHERE id = 'SUB_TEST_PREMIUM';

            UPDATE subscription
            SET stripe_plan_id = 'price_1GwSxyLcMbEgBKM55ErCUpkf',
                price                   = '9.99',
                max_tables              = '50',
                max_rows                = '100000'
            WHERE id = 'SUB_LIVE_BASIC';

            UPDATE subscription
            SET stripe_plan_id = 'price_1GwSxQLcMbEgBKM5qWA51ULd',
                price                   = '29.99',
                max_tables              = '200',
                max_rows                = '1000000',
                max_requests_per_minute = '10000'
            WHERE id = 'SUB_LIVE_PLUS';

            UPDATE subscription
            SET stripe_plan_id = 'price_1GwSvnLcMbEgBKM5PeSJGqnT',
                price                   = '99.99',
                max_tables              = '5000',
                max_rows                = '10000000',
                max_requests_per_minute = '100000'
            WHERE id = 'SUB_LIVE_PREMIUM';
        `);

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
                ('shetzel84@gmail.com',
                'SUB_LIVE_BASIC',
                'cus_HQRetHdF17ANo2',
                'sub_HQRebOWZmLCNZH',
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Steve',
                'Hetzel',
                'vvdKSwT7X1mnhHrDDDeUC8aFGLrM0u51',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_LIVE'),
                ('seh264@gmail.com',
                NULL,
                NULL,
                NULL,
                '$2b$12$WWTw.Tb3okO/3x/KpqyGQunXoXgkwUh1wUnfLpAOW5HhiAt.Xv64i',
                'Steve',
                'Hetzel',
                'fmh99QgCYnufhYDuAYSgpPblGAYgEWi7',
                FALSE,
                FALSE,
                NULL,
                'STRIPE_ENV_TEST');

            UPDATE account
            SET email = 'demo@invokedb.com'
            WHERE email = 'seh264@gmail.com';
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {}
}
