import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from 'passport-http-bearer';
import { PassportStrategy } from '@nestjs/passport';
import { Session } from '@app/core/session/session.entity';
import { ApiKeyService } from '../api-key/api-key.service';
import { is_expired } from '@app/core/helpers/is-expired';
import { is_verified } from '@app/core/email-verification/email-verification';

@Injectable()
export class HttpStrategy extends PassportStrategy(Strategy) {
    constructor(
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>,
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
                if (session && !is_expired(session.expired_datetime)) {
                    return session;
                }
            } else {
                const account = await this.api_key_service.account_from_key(key_or_token);
                // An API key works once the account's email is verified (#132)
                if (account && is_verified(account)) {
                    return account;
                }
            }
        }

        throw new UnauthorizedException();
    }
}
