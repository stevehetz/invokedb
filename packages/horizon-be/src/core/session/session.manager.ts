import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Session } from '@app/core/session/session.entity';
import { Account } from '@app/core/account/account.entity';
import logger from '@app/logger';

@Injectable()
export class SessionManager {
    constructor(
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>
    ) {}

    // Every sign-in (password, two-factor, Google, GitHub) makes a session here
    async create_session(account_id: number): Promise<any> {
        const session = await this.session_repository.save({
            token: await this.get_session_token(),
            account_id
        });
        await this.record_sign_in(account_id);
        return session;
    }

    // The idle rule for free accounts (#184): a sign-in starts its clock over and voids its
    // warnings. Never fails the sign-in.
    private async record_sign_in(account_id: number) {
        try {
            if (!account_id || !this.account_repository) return;
            await this.account_repository.update(
                { id: account_id },
                { last_sign_in_at: new Date(), idle_warned_at: null, idle_final_warned_at: null }
            );
        } catch (ex) {
            logger.error(`Sign-in of account ${account_id} not recorded: ${ex && ex.message}`);
        }
    }

    async get_session_token() {
        let token = `internal_${this.generate_uuid()}`;
        // fail safe
        let i = 0;

        const check_token = async () => {
            const session = await this.check_session_token(token);

            i++;
            if (session && i < 10) {
                token = this.generate_uuid();
                await check_token();
            }
        };

        await check_token();

        return token;
    }

    async check_session_token(token) {
        return this.session_repository.findOneBy({ token });
    }

    private generate_uuid() {
        return uuidv4();
    }
}
