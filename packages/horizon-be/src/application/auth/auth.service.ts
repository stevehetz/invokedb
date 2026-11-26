import { is_expired } from '@app/core/helpers/is-expired';
import { session_usable } from '@app/core/session/session-rules';
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
import { account_plan } from '@app/core/plan/plans';
import logger from '@app/logger';
import env from '@app/env';
import { validate_email } from '@app/core/helpers/validators';
import { SsoError, SsoIdentity } from './sso/sso-identity';
import { randomUUID } from 'crypto';
import { EmailVerification } from '@app/core/email-verification/email-verification.entity';
import {
    SIGNUP_ANSWER,
    VERIFY_LINK_HOURS,
    is_verified,
    verify_email_url
} from '@app/core/email-verification/email-verification';
import { verify_email_tmpl } from '@app/email/verify-email.template';
import { signup_attempt_tmpl } from '@app/email/signup-attempt.template';
import { OnboardingManager } from '@app/core/onboarding/onboarding.manager';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { parse_plan_state } from '@app/core/plan/plan-state';
import { AdminAccessService } from '../admin/admin-access.service';
import { account_theme } from '@app/core/theme/theme';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The plan `authorize` answers (#275): its id and name, and whether it has no counted caps. */
export function authorize_plan(account: Account): { id: string; name: string; internal: boolean } {
    const { plan, internal } = account_plan(account);
    return { id: plan.id, name: plan.name, internal };
}

const invalid_link = () =>
    new HttpException(
        'This link is invalid or has expired. Sign in to send a new one.',
        HttpStatus.BAD_REQUEST
    );

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
    @InjectRepository(EmailVerification)
    private readonly email_verification_repository: Repository<EmailVerification>,
    private account_manager: AccountManager,
    private session_manager: SessionManager,
    private email_manager: EmailManager,
    private onboarding_manager: OnboardingManager,
    private two_factor_service: TwoFactorService,
    private admin_access: AdminAccessService
  ) {}

    /**
     * Password sign-in. With two-factor on (#214) the right password answers
     * `{ two_factor_required: true, challenge }` instead of a session; `login_two_factor` trades
     * the challenge and a code for the session.
     */
    async login(account_dto: any) {
        const account = await this.account_manager.authenticate_account(
            account_dto?.email,
            account_dto?.password
        );

        if (await this.two_factor_service.is_enabled(account.id)) {
            return {
                two_factor_required: true,
                challenge: this.two_factor_service.start_login(account.id)
            };
        }

        return await this.session_manager.create_session(account.id);
    }

    /** The code step of a password sign-in with two-factor on (#214). Body `{ challenge, code }`. */
    async login_two_factor(dto: any) {
        const account = await this.two_factor_service.finish_login(dto?.challenge, dto?.code);
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
            // A deleted account's sessions answer null (#282)
            if (!session_usable(session, account)) {
                return null;
            }

            const res: any = {
                id: account.id,
                email: account.email,
                first_name: account.first_name,
                last_name: account.last_name,
                token: session.token,
                locked: account.locked,
                locked_reason: account.locked_reason,
                email_verified: is_verified(account),
                // The plan state (#184), for the app's banner
                plan_state: parse_plan_state(account.plan_state),
                grace_ends_at: account.grace_ends_at || null,
                // Shows the admin area's link (#277); its routes check again on every call
                admin: await this.admin_access.is_admin_account(account),
                // The account menu's plan, from the plan constant (#275)
                plan: authorize_plan(account),
                // The app's light/dark choice (#290)
                theme: account_theme(account.theme)
            };

            return res;
        } catch (ex) {
            throw new HttpException(
                'Error while looking up account session from token',
                HttpStatus.BAD_REQUEST
            );
        }
    }

    /**
     * Password signup (#132). The answer is the same whether or not the email already has an
     * account, so signup doesn't reveal which emails do (login and reset don't either). A new
     * account starts unverified and gets a verification link; an existing one gets a "someone
     * tried to sign up" email instead (none for a deleted account). The password is hashed on
     * both paths, so the time taken doesn't tell them apart either; emails are sent in the
     * background.
     */
    async create_account(account_dto: any) {
        const email = account_dto?.email;
        if (!email || typeof email !== 'string') {
            throw new HttpException('Email is required', HttpStatus.BAD_REQUEST);
        }

        this.account_manager.validate_account_info(account_dto);

        const password_hash = await this.account_manager.hash_password(account_dto.password);

        const existing = await this.account_manager.find_by_email_any_case(email);
        if (existing) {
            logger.info(`Signup for an email that already has an account (ID ${existing.id}).`);
            if (!existing.deleted) this.send_signup_attempt(existing.email);
            return SIGNUP_ANSWER;
        }

        // No API key yet: once the email is verified (#132), the account makes its keys on the
        // Account page (#138)
        const account = await this.account_repository.save({
            email,
            password_hash,
            email_verified: false
        });

        logger.info(`Account created. ID: ${account.id}, Email: ${account.email}.`);
        // The onboarding funnel starts here (#169)
        await this.onboarding_manager.record_signup(account.id);

        await this.send_verification(account);

        return SIGNUP_ANSWER;
    }

    /** The link in the verification email. Answers 400 for an unknown or expired link. */
    async verify_email(token: unknown) {
        // The column is a uuid: anything else would make Postgres throw
        if (typeof token !== 'string' || !UUID.test(token)) throw invalid_link();

        const verification = await this.email_verification_repository.findOneBy({ token });
        if (!verification || is_expired(verification.expired_datetime)) throw invalid_link();

        const account_id = verification.account_id;
        await this.account_repository.update({ id: account_id }, { email_verified: true });
        await this.email_verification_repository.delete({ account_id });
        logger.info(`Email verified for account ${account_id}.`);
        await this.onboarding_manager.record_email_verified(account_id);

        return { email_verified: true };
    }

    /** The app's "Resend" banner: a new link for the signed-in account, if it isn't verified. */
    async resend_verification(account_id: number) {
        const account = await this.account_repository.findOneBy({ id: account_id });
        if (!account || account.deleted) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
        if (is_verified(account)) return { email_verified: true };

        await this.send_verification(account);
        return { email_verified: false, sent: true };
    }

    // One live link per account: a new one replaces any sent before
    private async send_verification(account: { id: number; email: string }) {
        await this.email_verification_repository.delete({ account_id: account.id });
        const token = randomUUID();
        // expired_datetime is filled in by the column default (24 hours)
        await this.email_verification_repository.save({ token, account_id: account.id });

        const site = env.HORIZON_FE_PUB_HTTP_URL;
        const { subject, body } = verify_email_tmpl(
            site,
            verify_email_url(site, token),
            VERIFY_LINK_HOURS
        );
        this.email_manager.send_html(account.email, subject, body);
    }

    private send_signup_attempt(email: string) {
        const { subject, body } = signup_attempt_tmpl(env.HORIZON_FE_PUB_HTTP_URL);
        this.email_manager.send_html(email, subject, body);
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
     *    It never links to an account that has a password: accounts from before #132 never
     *    verified their email (and #132 left linking out), so whoever set that password may not
     *    own the mailbox, and linking would put the
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
            last_name: identity.last_name,
            // The provider verified the email (identity.email is null otherwise)
            email_verified: true
        });

        logger.info(
            `Account created through ${identity.provider} sign-in. ID: ${account.id}, Email: ${account.email}.`
        );
        // Signed up and verified at once (#169)
        await this.onboarding_manager.record_signup(account.id);
        await this.onboarding_manager.record_email_verified(account.id);
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

            // The reset link was opened from the account's mailbox, which proves the email too
            await this.account_repository.update(
                { id: account.id },
                { password_hash, email_verified: true }
            );
            await this.email_verification_repository.delete({ account_id: account.id });

            await this.reset_password_repository.remove(reset_pass);
            await this.session_repository.delete({ account_id: account.id });
        } catch (ex) {
            throw new Error('Could not reset password');
        }

        return 'success';
    }
}
