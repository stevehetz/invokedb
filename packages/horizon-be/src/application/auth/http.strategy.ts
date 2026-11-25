import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from 'passport-http-bearer';
import { PassportStrategy } from '@nestjs/passport';
import { Session } from '@app/core/session/session.entity';
import { AccountService } from '../account/account.service';
import { is_expired } from '@app/core/helpers/is-expired';
import { is_verified } from '@app/core/email-verification/email-verification';

@Injectable()
export class HttpStrategy extends PassportStrategy(Strategy) {
    constructor(
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>,
        private readonly account_service: AccountService
    ) {
        super();
    }

    async validate(key_or_token: string) {
        if (key_or_token) {
            if (key_or_token.indexOf('internal_') > -1) {
                const session = await this.session_repository.findOneBy({ token: key_or_token });
                if (session && !is_expired(session.expired_datetime)) {
                    return session;
                }
            } else {
                const account = await this.account_service.account_from_key(key_or_token);
                // An API key works once the account's email is verified (#132)
                if (account && is_verified(account)) {
                    return account;
                }
            }
        }

        throw new UnauthorizedException();
    }
}
