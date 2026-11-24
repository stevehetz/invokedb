import { Entity, Column, CreateDateColumn, PrimaryGeneratedColumn } from 'typeorm';

// A Google or GitHub login linked to an account (see AuthService.sso_login). One account can
// have several; each (provider, provider_user_id) belongs to one account.
@Entity()
export class AccountIdentity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar' })
    provider: string;

    @Column({ type: 'varchar' })
    provider_user_id: string;

    @Column()
    account_id: number;

    @CreateDateColumn()
    created_datetime: Date;
}
