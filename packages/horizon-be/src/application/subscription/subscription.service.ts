import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { Subscription } from '@app/core/subscription/subscription.entity';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import logger from '@app/logger';

@Injectable()
export class SubscriptionService {
    constructor(
        @InjectRepository(Subscription)
        private readonly subscription_repository: Repository<Subscription>,
        private tracking_manager: TrackingManager
    ) {}

    async get(id) {
        return await this.subscription_repository.findOne({ id });
    }

    async get_by_plan_id(stripe_plan_id) {
        return await this.subscription_repository.findOne({ stripe_plan_id });
    }

    async get_all(stripe_env_id) {
        return await this.subscription_repository.find({
            stripe_env_id,
            enabled: true
        });
    }

    async on_subscription_change(account) {
        logger.info(
            `${account.email} has changed their subscription to ${account.subscription_id}`
        );
        await this.tracking_manager.update_limits(account);
        await this.tracking_manager.update_account_lock(account);
        await this.tracking_manager.update_account_table_locks(account);
    }
}
