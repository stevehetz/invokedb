import { is_expired } from '@app/core/helpers/is-expired';
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '@app/core/session/session.entity';
import { Account } from '@app/core/account/account.entity';
import { ResetPassword } from '@app/core/reset-password/reset-password.entity';
import { AccountIdentity } from '@app/core/account-identity/account-identity.entity';
import { AccountManager } from '@app/core/account/account.manager';
import { SessionManager } from '@app/core/session/session.manager';
import { EmailManager } from '@app/email/email.manager';
import { welcome_tmpl } from '@app/email/welcome.template';
import { reset_pass_tmpl } from '@app/email/reset-pass.template';
import { SubscriptionService } from '../subscription/subscription.service';
import logger from '@app/logger';
import env from '@app/env';
import { validate_email } from '@app/core/helpers/validators';
import { SsoError, SsoIdentity } from './sso/sso-identity';

@Injectable()
export class AuthService {
    // prettier-ignore
    constructor(
    @InjectRepository(Session)
    private readonly session_repository: Repository<Session>,
    @InjectRepository(Account)
    private readonly account_repository: Repository<Account>,
    @InjectRepository(ResetPassword)
    private readonly reset_password_repository: Repository<ResetPassword>,
    @InjectRepository(AccountIdentity)
    private readonly identity_repository: Repository<AccountIdentity>,
    private account_manager: AccountManager,
    private session_manager: SessionManager,
    private email_manager: EmailManager,
    private subscription_service: SubscriptionService
  ) {}

    async login(account_dto: any) {
        const account = await this.account_manager.authenticate_account(
            account_dto.email,
            account_dto.password
        );

        return await this.session_manager.create_session(account.id);
    }

    async logout(token: string) {
        if (!token) return null;
        return await this.session_repository.delete({ token });
    }

    async authorize(token: string): Promise<any> {
        if (!token) return null;
        try {
            const session = await this.session_repository.findOneBy({ token });
            if (!session || is_expired(session.expired_datetime)) {
                return null;
            }

            const account = await this.account_repository.findOneBy({
                id: session.account_id
            });
            if (!account) {
                return null;
            }

            const res: any = {
                id: account.id,
                email: account.email,
                first_name: account.first_name,
                last_name: account.last_name,
                token: session.token,
                locked: account.locked,
                locked_reason: account.locked_reason
            };

            if (account.subscription_id) {
                res.subscription = await this.subscription_service.get(account.subscription_id);
            }

            return res;
        } catch (ex) {
            throw new HttpException(
                'Error while looking up account session from token',
                HttpStatus.BAD_REQUEST
            );
        }
    }

    async create_account(account_dto: any) {
        await this.account_manager.check_if_exists(account_dto.email);

        this.account_manager.validate_account_info(account_dto);

        const password_hash = await this.account_manager.hash_password(account_dto.password);

        // No API key yet: the account makes its keys on the Account page (#138)
        const account = await this.account_repository.save({
            email: account_dto.email,
            password_hash
        });

        logger.info(`Account created. ID: ${account.id}, Email: ${account.email}.`);

        this.send_welcome(account);

        return 'success';
    }

    private send_welcome(account: { email: string }) {
        // One frontend: the public site at /, the signed-in app under /app
        const { subject, body } = welcome_tmpl(
            env.HORIZON_FE_PUB_HTTP_URL,
            `${env.HORIZON_FE_PUB_HTTP_URL}/app`,
            account
        );

        this.email_manager.send_html(account.email, subject, body);
    }

    /**
     * Google / GitHub sign-in: find or create the account for a provider login and start a
     * session, as the password login does.
     *
     * 1. A login linked before signs in to its account.
     * 2. Otherwise it links to the account with the same email, but only when the provider says
     *    the email is verified (`identity.email` is null when it isn't). Anyone can put any
     *    address on a GitHub account, so an unverified one must never reach an existing account.
     *    It never links to an account that has a password: password signup doesn't verify the
     *    email, so whoever set that password may not own the mailbox, and linking would put the
     *    owner in an account someone else can still enter (and whose API key they have seen).
     *    Such an account signs in with its password (or resets it through the mailbox).
     * 3. Otherwise a new account is created, with no password (it can set one through "Forgot
     *    password"). This also needs a verified email: the welcome and reset emails go there.
     */
    async sso_login(identity: SsoIdentity): Promise<Session> {
        const { provider, provider_user_id } = identity;
        if (!provider_user_id) throw new SsoError('failed');

        const linked = await this.identity_repository.findOneBy({ provider, provider_user_id });
        if (linked) {
            const account = await this.account_repository.findOneBy({
                id: linked.account_id,
                deleted: false
            });
            if (!account) throw new SsoError('account_deleted');
            return await this.session_manager.create_session(account.id);
        }

        if (!identity.email) throw new SsoError('no_verified_email');

        const existing = await this.find_account_by_email(identity.email);
        if (existing?.password_hash) throw new SsoError('password_account');
        const account = existing ?? (await this.create_sso_account(identity));

        await this.identity_repository.save({ provider, provider_user_id, account_id: account.id });
        logger.info(`Linked a ${provider} login to account ${account.id}.`);

        return await this.session_manager.create_session(account.id);
    }

    // Emails are compared without case (Foo@x.com and foo@x.com are one mailbox). An exact match
    // wins if there are several. A deleted account's email isn't reused.
    private async find_account_by_email(email: string): Promise<Account | null> {
        const matches = await this.account_repository
            .createQueryBuilder('account')
            .where('LOWER(account.email) = LOWER(:email)', { email })
            .getMany();
        if (!matches.length) return null;

        const live = matches.filter(a => !a.deleted);
        if (!live.length) throw new SsoError('account_deleted');
        return live.find(a => a.email === email) ?? live[0];
    }

    private async create_sso_account(identity: SsoIdentity): Promise<Account> {
        // account.email is VARCHAR(50)
        if (identity.email.length > 50 || !validate_email(identity.email)) {
            throw new SsoError('failed');
        }

        const account = await this.account_repository.save({
            email: identity.email,
            password_hash: null,
            first_name: identity.first_name,
            last_name: identity.last_name
        });

        logger.info(
            `Account created through ${identity.provider} sign-in. ID: ${account.id}, Email: ${account.email}.`
        );
        this.send_welcome(account);

        return account;
    }

    // Always answers 'success', whether or not the email has an account, so the reply doesn't
    // reveal which emails do. The email is sent in the background, so timing doesn't either.
    async reset_password(email) {
        if (!email || typeof email !== 'string') return 'success';
        const account = await this.account_repository.findOneBy({ email, deleted: false });
        if (!account) {
            logger.info(`Password reset requested for an email with no account.`);
            return 'success';
        }

        // Sessions are revoked when the reset completes (change_password), not here: anyone can
        // request a reset for any email, so doing it here would let them log the owner out.
        const token = await this.account_manager.get_reset_password_token();

        await this.reset_password_repository.save({
            token,
            account_id: account.id
        });

        const { subject, body } = reset_pass_tmpl(env.HORIZON_FE_PUB_HTTP_URL, token);

        this.email_manager.send_html(account.email, subject, body);

        return 'success';
    }

    async confirm_reset_token(token) {
        return await this.account_manager.get_account_from_reset_pass_token(token);
    }

    async change_password(data) {
        this.account_manager.validate_password(data.password);

        try {
            const { token, password } = data;

            if (!token) throw new Error('No token');
            const reset_pass = await this.reset_password_repository.findOneBy({ token });
            if (!reset_pass || is_expired(reset_pass.expired_datetime)) {
                throw new Error('Reset token not found or expired');
            }

            const account = await this.account_repository.findOneBy({
                id: reset_pass.account_id
            });

            const password_hash = await this.account_manager.hash_password(password);

            await this.account_repository.update({ id: account.id }, { password_hash });

            await this.reset_password_repository.remove(reset_pass);
            await this.session_repository.delete({ account_id: account.id });
        } catch (ex) {
            throw new Error('Could not reset password');
        }

        return 'success';
    }
}
