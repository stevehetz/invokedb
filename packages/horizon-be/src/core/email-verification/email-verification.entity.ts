import { Entity, Column, PrimaryColumn } from 'typeorm';

// A link that proves an account owns its email (#132). It expires after 24 hours (the column's
// default, see the EmailVerification migration).
@Entity()
export class EmailVerification {
    @PrimaryColumn()
    token: string;

    @Column()
    account_id: number;

    @Column()
    expired_datetime: Date;
}
