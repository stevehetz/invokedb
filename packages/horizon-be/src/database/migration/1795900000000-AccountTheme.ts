import { MigrationInterface, QueryRunner } from 'typeorm';

// The app's light/dark theme (#290): 'system', 'light' or 'dark' (core/theme/theme.ts)
export class AccountTheme1795900000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE account ADD COLUMN theme VARCHAR(10) NOT NULL DEFAULT 'system'`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE account DROP COLUMN theme`);
    }
}
