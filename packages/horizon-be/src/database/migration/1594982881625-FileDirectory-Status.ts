import { MigrationInterface, QueryRunner } from 'typeorm';

export class FileDirectoryStatus1594982881625 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`ALTER TABLE file_directory ADD COLUMN status VARCHAR (20)`);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`ALTER TABLE file_directory DROP COLUMN status`);
    }
}
