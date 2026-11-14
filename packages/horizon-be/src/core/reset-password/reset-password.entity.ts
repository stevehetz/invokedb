import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class ResetPassword {
    @PrimaryColumn()
    token: string;

    @Column()
    account_id: number;

    @Column()
    expired_datetime: Date;
}
