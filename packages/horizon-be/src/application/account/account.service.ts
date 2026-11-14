import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Repository, createQueryBuilder } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from '@app/core/account/account.entity';
import { AccountManager } from '@app/core/account/account.manager';
import { AccountGetDto } from './dto/account-get.dto';
import { AccountUpdateDto } from './dto/account-update.dto';
import { AccountPassChangeDto } from './dto/account-pass-change.dto';
import { paging_helper } from '@app/web/http/_paging/paging-helper';
import { StripeEnvService } from '../stripe.service/stripe.service';

@Injectable()
export class AccountService {
    // prettier-ignore
    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        private account_manager: AccountManager,
        private stripe_env_service: StripeEnvService
    ) {}

    async get_stripe_env(account) {
        return await this.stripe_env_service.get(account.stripe_env_id);
    }

    async get(id) {
        return await this.account_repository.findOneBy({ id });
    }

    async get_by_stripe_customer_id(stripe_customer_id) {
        if (!stripe_customer_id) return null;
        return await this.account_repository.findOneBy({ stripe_customer_id });
    }

    async get_all(params) {
        return paging_helper(params, this.account_repository, AccountGetDto);
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
                const constraints = { badPassword: ex.message };
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
        const account = await this.get(account_id);
        const stripe_env = await this.get_stripe_env(account);
        const stripe = require('stripe')(stripe_env.stripe_account_secret_key);
        if (account.stripe_subscription_id) {
            await stripe.subscriptions.del(account.stripe_subscription_id);
        }
        return await this.account_repository.update({ id: account_id }, { deleted: true });
    }
}
