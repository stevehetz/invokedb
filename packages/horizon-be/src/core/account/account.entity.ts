import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { FileDirectory } from '../file-directory/file-directory.entity';

@Entity()
export class Account {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    email: string;

    // Null for an account created through Google or GitHub sign-in
    @Column({ type: 'varchar', nullable: true })
    password_hash: string | null;

    @Column()
    first_name: string;

    @Column()
    last_name: string;

    @Column()
    api_key: string;

    @Column()
    subscription_id: string;

    @Column()
    deleted: boolean;

    @Column()
    stripe_customer_id: string;

    @Column()
    stripe_subscription_id: string;

    @Column()
    locked: boolean;

    @Column()
    locked_reason: string;

    @Column()
    stripe_env_id: string;
}
