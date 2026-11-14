import { Entity, Column, CreateDateColumn, PrimaryColumn } from 'typeorm';

@Entity()
export class Session {
    @PrimaryColumn()
    token: string;

    @Column()
    account_id: number;

    @CreateDateColumn()
    created_datetime: Date;

    @Column()
    expired_datetime: Date;
}
