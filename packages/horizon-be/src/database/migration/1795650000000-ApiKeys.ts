import { MigrationInterface, QueryRunner } from 'typeorm';

// Several API keys per account, read-only or read-write, optionally limited to some tables, and
// revocable (#138). Only a SHA-256 of each key is kept (and its first 6 characters, to tell keys
// apart). Each account's old key becomes a read-write key for every table, so clients using it
// keep working; then the plain-text column goes. The hash is the same as hash_api_key's
// (core/api-key/api-key-rules.ts): hex SHA-256 of the key's UTF-8 bytes.
export class ApiKeys1795650000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE api_key (
                id SERIAL PRIMARY KEY,
                account_id INT NOT NULL references account(id),
                name VARCHAR (100) NOT NULL,
                prefix VARCHAR (8) NOT NULL,
                key_hash VARCHAR (64) NOT NULL UNIQUE,
                access VARCHAR (20) NOT NULL,
                table_ids INT[],
                created_datetime TIMESTAMP NOT NULL DEFAULT current_timestamp,
                last_used_datetime TIMESTAMP,
                revoked_datetime TIMESTAMP
            )
        `);
        await queryRunner.query(`CREATE INDEX api_key_account_id ON api_key (account_id)`);
        // Keys were meant to be unique; if two accounts ever shared one, the older account keeps it
        await queryRunner.query(`
            INSERT INTO api_key (account_id, name, prefix, key_hash, access)
            SELECT id, 'Account key', left(api_key, 6),
                   encode(sha256(convert_to(api_key, 'UTF8')), 'hex'), 'read_write'
            FROM account
            WHERE api_key IS NOT NULL AND api_key <> ''
            ORDER BY id
            ON CONFLICT (key_hash) DO NOTHING
        `);
        await queryRunner.query(`ALTER TABLE account DROP COLUMN api_key`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // The old keys can't come back (only their hashes were kept): each account gets a new
        // random 32-character key, and every client needs it.
        await queryRunner.query(`ALTER TABLE account ADD COLUMN api_key VARCHAR (32)`);
        await queryRunner.query(
            `UPDATE account SET api_key = replace(gen_random_uuid()::text, '-', '')`
        );
        await queryRunner.query(`DROP TABLE api_key`);
    }
}
