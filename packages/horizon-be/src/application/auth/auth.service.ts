import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session } from '@app/core/session/session.entity';
import { Account } from '@app/core/account/account.entity';
import { ResetPassword } from '@app/core/reset-password/reset-password.entity';
import { AccountManager } from '@app/core/account/account.manager';
import { SessionManager } from '@app/core/session/session.manager';
import { EmailManager } from '@app/email/email.manager';
import { welcome_tmpl } from '@app/email/welcome.template';
import { reset_pass_tmpl } from '@app/email/reset-pass.template';
import { SubscriptionService } from '../subscription/subscription.service';
import logger from '@app/logger';
import env from '@app/env';

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
            if (!session) {
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
                locked_reason: account.locked_reason,
                api_key: account.api_key
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

        const api_key = await this.get_unique_api_key();

        if (!api_key) {
            throw new Error('Could not find a unique API key');
        }

        const account = await this.account_repository.save({
            email: account_dto.email,
            password_hash,
            api_key
        });

        logger.info(`Account created. ID: ${account.id}, Email: ${account.email}.`);

        // One frontend: the public site at /, the signed-in app under /app
        const { subject, body } = welcome_tmpl(
            env.HORIZON_FE_PUB_HTTP_URL,
            `${env.HORIZON_FE_PUB_HTTP_URL}/app`,
            account
        );

        this.email_manager.send_html(account.email, subject, body);

        return 'success';
    }

    async get_unique_api_key() {
        const total_tries = 5;
        let tries = 0;
        let unique_key;

        const go = async () => {
            if (tries < total_tries) {
                tries++;
                const api_key = this.account_manager.generate_api_key();
                const account = await this.account_repository.findOneBy({ api_key });
                if (account) {
                    await go();
                } else {
                    unique_key = api_key;
                }
            }
        };

        await go();

        return unique_key;
    }

    async reset_password(email) {
        if (!email) throw new Error('An account with that email does not exist');
        const account = await this.account_repository.findOneBy({ email });
        if (!account) throw new Error('An account with that email does not exist');

        await this.session_repository.delete({
            account_id: account.id
        });

        const token = await this.account_manager.get_reset_password_token();

        this.reset_password_repository.save({
            token,
            account_id: account.id
        });

        const { subject, body } = reset_pass_tmpl(env.HORIZON_FE_PUB_HTTP_URL, token);

        this.email_manager.send_html(email, subject, body);

        return 'success';
    }

    async confirm_reset_token(token) {
        return await this.account_manager.get_account_from_reset_pass_token(token);
    }

    async change_password(data) {
        this.account_manager.validate_password(data.password);

        try {
            const { token, password } = data;

            const reset_pass = await this.reset_password_repository.findOneBy({ token });

            const account = await this.account_repository.findOneBy({
                id: reset_pass.account_id
            });

            const password_hash = await this.account_manager.hash_password(password);

            await this.account_repository.update({ id: account.id }, { password_hash });

            await this.reset_password_repository.remove(reset_pass);
        } catch (ex) {
            throw new Error('Could not reset password');
        }

        return 'success';
    }
}
