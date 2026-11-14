import { MigrationInterface, QueryRunner } from 'typeorm';

export class StatusReason1594998557136 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`ALTER TABLE file_directory ADD COLUMN status_reason VARCHAR (200)`);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`ALTER TABLE file_directory DROP COLUMN status_reason`);
    }
}
