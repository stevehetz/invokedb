import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from 'passport-http-bearer';
import { PassportStrategy } from '@nestjs/passport';
import { Session } from '@app/core/session/session.entity';
import { ApiKeyService } from '../api-key/api-key.service';
import { Account } from '@app/core/account/account.entity';
import { session_usable } from '@app/core/session/session-rules';
import { is_verified } from '@app/core/email-verification/email-verification';
import { is_demo_account } from '@app/core/demo/demo';

@Injectable()
export class HttpStrategy extends PassportStrategy(Strategy) {
    constructor(
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        private readonly api_key_service: ApiKeyService
    ) {
        super();
    }

    // A login token gives its Session; an API key gives its Account, with the key's scope on it
    // (`key_scope`, #138)
    async validate(key_or_token: string) {
        if (key_or_token) {
            if (key_or_token.indexOf('internal_') > -1) {
                const session = await this.session_repository.findOneBy({ token: key_or_token });
                // A deleted account's sessions are refused (#282), and an expired demo's (#333)
                const account =
                    session &&
                    (await this.account_repository.findOne({
                        select: { id: true, deleted: true, demo_expires_at: true },
                        where: { id: session.account_id }
                    }));
                if (session_usable(session, account)) {
                    return session;
                }
            } else {
                const account = await this.api_key_service.account_from_key(key_or_token);
                // An API key works once the account's email is verified (#132), and never for
                // a demo account (#333; it can't make one either)
                if (account && is_verified(account) && !is_demo_account(account)) {
                    return account;
                }
            }
        }

        throw new UnauthorizedException();
    }
}
