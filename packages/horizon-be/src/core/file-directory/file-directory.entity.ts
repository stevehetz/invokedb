import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm';
import { Account } from '../account/account.entity';

@Entity()
export class FileDirectory {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    account_id: number;

    @Column()
    name: string;

    @Column()
    type: string;

    @Column()
    web_file_type: string;

    @Column()
    parent_id: number;

    @Column()
    deleted: boolean;

    @Column()
    locked: boolean;

    @Column()
    locked_reason: string;

    @Column()
    status: string;

    @Column()
    status_reason: string;
}
