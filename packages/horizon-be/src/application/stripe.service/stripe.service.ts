import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StripeEnv } from '@app/core/stripe/stripe-env.entity';
import env from '@app/env';

@Injectable()
export class StripeEnvService {
    constructor(
        @InjectRepository(StripeEnv)
        private readonly stripe_env_repository: Repository<StripeEnv>
    ) {}

    async get(stripe_env_id) {
        return await this.stripe_env_repository.findOneBy({ id: stripe_env_id });
    }
}
