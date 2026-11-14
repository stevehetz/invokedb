import { Injectable, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Session } from '@app/core/session/session.entity';

@Injectable()
export class SessionManager {
    constructor(
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>
    ) {}

    async create_session(account_id: number): Promise<any> {
        const session = await this.session_repository.save({
            token: await this.get_session_token(),
            account_id
        });
        return session;
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
