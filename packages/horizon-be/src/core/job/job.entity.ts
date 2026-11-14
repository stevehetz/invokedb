import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity()
export class Job {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    account_id: number;

    @Column()
    file_id: number;

    @Column()
    file_name: string;

    @Column()
    event: string;

    @Column('simple-json')
    data: {};

    @CreateDateColumn()
    created_datetime: Date;

    @Column()
    job_processor_id: string;

    @Column()
    status: string;

    @Column()
    status_reason: string;

    @Column()
    restarts: number;
}
