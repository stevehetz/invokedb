import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@app/core/account/account.entity';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { is_admin, parse_admin_emails } from '@app/core/admin/admin';
import env from '@app/env';

// Who may use the admin area (#277): an account on HORIZON_ADMIN_EMAILS with a verified email
// and two-factor sign-in on. AdminGuard asks on every admin route; `GET /auth/authorize` asks so
// the app shows the Admin link.
@Injectable()
export class AdminAccessService {
    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        private readonly two_factor_service: TwoFactorService
    ) {}

    // Read on every call, so tests (and a restart with a new env) see the current list
    admin_emails: () => Set<string> = () => parse_admin_emails(env.HORIZON_ADMIN_EMAILS);

    /** The admin's account, or null when `account_id` isn't an admin's. */
    async admin_account(account_id: number): Promise<Account | null> {
        const emails = this.admin_emails();
        if (!account_id || emails.size === 0) return null;
        const account = await this.account_repository.findOneBy({ id: account_id });
        return await this.check(account, emails);
    }

    /** Whether an account already loaded is an admin's. */
    async is_admin_account(account: Account | null): Promise<boolean> {
        const emails = this.admin_emails();
        if (!account || emails.size === 0) return false;
        return (await this.check(account, emails)) !== null;
    }

    private async check(account: Account | null, emails: Set<string>) {
        // The cheap checks first: two-factor is a query
        if (!is_admin(account, true, emails)) return null;
        const two_factor = await this.two_factor_service.is_enabled(account.id);
        return is_admin(account, two_factor, emails) ? account : null;
    }
}
