import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubIdColumnType1598102072015 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`ALTER TABLE session ALTER COLUMN token TYPE VARCHAR (200)`);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {}
}
