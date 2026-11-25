import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Account } from '@app/core/account/account.entity';
import { ResetPassword } from '../reset-password/reset-password.entity';
import { is_expired } from '@app/core/helpers/is-expired';
import { validate_email, validate_password } from '@app/core/helpers/validators';

const bcrypt = require('bcryptjs');

// A hash of a random value at the same cost as real ones (generate_hash), for timing-safe logins.
const DUMMY_HASH = bcrypt.hashSync(uuidv4(), 12);

@Injectable()
export class AccountManager {
    constructor(
        @InjectRepository(Account)
        private account_repository: Repository<Account>,
        @InjectRepository(ResetPassword)
        private reset_password_repository: Repository<ResetPassword>
    ) {}

    // One message for a missing account and a wrong password, and a bcrypt compare either way
    // (against DUMMY_HASH when there's no account), so neither the reply nor its timing reveals
    // which emails have accounts.
    async authenticate_account(email, password) {
        const account =
            email && typeof email === 'string'
                ? await this.account_repository.findOneBy({ email, deleted: false })
                : null;

        const valid_password = await bcrypt.compare(
            typeof password === 'string' ? password : '',
            account?.password_hash || DUMMY_HASH
        );
        if (!account || !valid_password) {
            throw new HttpException('Invalid email or password', HttpStatus.BAD_REQUEST);
        }

        return account;
    }

    async check_if_exists(email) {
        if (!email) throw new HttpException('Email is required', HttpStatus.BAD_REQUEST);
        const existing = await this.account_repository.findOneBy({ email });

        if (existing)
            throw new HttpException(
                'An account with that email already exists',
                HttpStatus.BAD_REQUEST
            );
    }

    validate_account_info(account) {
        if (!validate_email(account.email))
            throw new HttpException('Email format is invalid', HttpStatus.BAD_REQUEST);
        if (!validate_password(account.password))
            throw new HttpException(
                'A password must be at least 8 characters long and contain: 1 lowercase letter, 1 uppercase letter, 1 number and 1 special character (anything other than a letter or number)',
                HttpStatus.BAD_REQUEST
            );
    }

    validate_password(password) {
        if (!validate_password(password))
            throw new HttpException(
                'A password must be at least 8 characters long and contain: 1 lowercase letter, 1 uppercase letter, 1 number and 1 special character (anything other than a letter or number)',
                HttpStatus.BAD_REQUEST
            );
    }

    async get_reset_password_token() {
        let token = this.generate_uuid();
        // fail safe
        let i = 0;

        const check_token = async () => {
            const reset_password_record = await this.check_reset_password_token(token);

            i++;
            if (reset_password_record && i < 10) {
                token = this.generate_uuid();
                await check_token();
            }
        };

        await check_token();

        return token;
    }

    async check_reset_password_token(token) {
        if (!token) return null;
        return await this.reset_password_repository.findOneBy({ token });
    }

    async get_account_from_reset_pass_token(token) {
        try {
            const reset_pass = await this.reset_password_repository.findOneBy({ token });

            if (!reset_pass || is_expired(reset_pass.expired_datetime))
                throw new Error('Reset password token not found');

            const account = await this.account_repository.findOneBy({
                id: reset_pass.account_id
            });

            if (!account) throw new Error('No account associated with reset password token');

            return {
                id: account.id,
                email: account.email
            };
        } catch (ex) {
            throw new Error('Could not find reset password token');
        }
    }

    async hash_password(password) {
        return await this.generate_hash(password);
    }

    private async generate_hash(value) {
        return await bcrypt.hash(value, 12);
    }

    private generate_uuid() {
        return uuidv4();
    }
}
