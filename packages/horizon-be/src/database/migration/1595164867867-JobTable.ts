import { MigrationInterface, QueryRunner } from 'typeorm';

export class JobTable1595164867867 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            CREATE TABLE job (
                id SERIAL PRIMARY KEY,
                account_id INT,
                file_id INT,
                file_name VARCHAR (200),
                event VARCHAR (50),
                data json,
                created_datetime TIMESTAMP DEFAULT current_timestamp,
                job_processor_id VARCHAR (70),
                status VARCHAR (30),
                status_reason VARCHAR (200),
                restarts INT
            );
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
        queryRunner.query(`
            DROP TABLE job;
        `);
    }
}
