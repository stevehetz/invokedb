import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Account } from '@app/core/account/account.entity';
import { Session } from '@app/core/session/session.entity';
import { AccountManager } from '@app/core/account/account.manager';
import { AccountUpdateDto } from './dto/account-update.dto';
import { AccountPassChangeDto } from './dto/account-pass-change.dto';
import type { Theme } from '@app/core/theme/theme';
import { AccountDeletionService } from './account-deletion.service';
import logger from '@app/logger';

@Injectable()
export class AccountService {
    // prettier-ignore
    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>,
        private account_manager: AccountManager,
        private readonly deletion: AccountDeletionService
    ) {}

    async get(id) {
        return await this.account_repository.findOneBy({ id });
    }

    async update(account_id, update_dto: AccountUpdateDto) {
        await this.account_repository.update(account_id, update_dto);
        return account_id;
    }

    async set_theme(account_id: number, theme: Theme) {
        await this.account_repository.update({ id: account_id }, { theme });
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

    // Runs first when an account is deleted, and can refuse it by throwing: BillingService
    // cancels the account's Stripe subscription (#129), since a deleted account can't reach the
    // billing portal
    private before_delete: ((account_id: number) => Promise<void>) | null = null;

    set_before_delete(fn: (account_id: number) => Promise<void>) {
        this.before_delete = fn;
    }

    /**
     * Deletes the account and all its data at once (#279). First it's marked deleted and all its
     * sessions end, on every device (#282), so it's unusable even if the rest fails; then
     * AccountDeletionService removes its tables, tracking data and Postgres rows, the account
     * row last. A deletion that fails half-way is finished by DeletedAccountService's sweep.
     */
    async delete_account(account_id: number) {
        if (this.before_delete) await this.before_delete(account_id);
        await this.account_repository.update({ id: account_id }, { deleted: true });
        await this.session_repository.delete({ account_id });
        try {
            await this.deletion.delete_account(account_id);
        } catch (ex) {
            logger.error(
                `Account ${account_id} marked deleted, but its data isn't deleted yet (the ` +
                    `processor's sweep tries again): ${ex && ex.message}`
            );
        }
        return { deleted: true };
    }
}
