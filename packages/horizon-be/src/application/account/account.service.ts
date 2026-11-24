import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from '@app/core/account/account.entity';
import { AccountManager } from '@app/core/account/account.manager';
import { AccountUpdateDto } from './dto/account-update.dto';
import { AccountPassChangeDto } from './dto/account-pass-change.dto';

@Injectable()
export class AccountService {
    // prettier-ignore
    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        private account_manager: AccountManager
    ) {}

    async get(id) {
        return await this.account_repository.findOneBy({ id });
    }

    async account_from_key(api_key) {
        if (!api_key) return null;
        return await this.account_repository.findOneBy({ api_key });
    }

    async update(account_id, update_dto: AccountUpdateDto) {
        await this.account_repository.update(account_id, update_dto);
        return account_id;
    }

    async change_password(account_id: number, passwords_dto: AccountPassChangeDto) {
        const { current_password, new_password } = passwords_dto;
        const account = await this.account_repository.findOneBy({ id: account_id });

        const validation_errors = [];

        // Validate current password
        try {
            await this.account_manager.authenticate_account(account.email, current_password);
        } catch (ex) {
            if (ex.status === HttpStatus.BAD_REQUEST) {
                const property = 'current_password';
                const constraints = { badPassword: 'Current password is incorrect' };
                validation_errors.push({ property, constraints });
            } else {
                throw ex;
            }
        }

        // Validate new password
        try {
            this.account_manager.validate_password(new_password);
        } catch (ex) {
            if (ex.status === HttpStatus.BAD_REQUEST) {
                const property = 'new_password';
                const constraints = { badPassword: ex.message };
                validation_errors.push({ property, constraints });
            } else {
                throw ex;
            }
        }

        if (validation_errors.length > 0) {
            throw new HttpException(validation_errors, HttpStatus.BAD_REQUEST);
        }

        const password_hash = await this.account_manager.hash_password(new_password);

        await this.account_repository.update({ id: account.id }, { password_hash });

        return await account_id;
    }

    async delete_account(account_id) {
        return await this.account_repository.update({ id: account_id }, { deleted: true });
    }
}
