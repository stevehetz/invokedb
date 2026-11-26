import { Injectable } from '@nestjs/common';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import logger from '@app/logger';

@Injectable()
export class SubscriptionService {
    constructor(private tracking_manager: TrackingManager) {}

    async on_subscription_change(account) {
        logger.info(
            `${account.email} has changed their subscription to ${account.subscription_id}`
        );
        // The caps come from the plan constant (core/plan/plans.ts): nothing to copy (#183)
        await this.tracking_manager.update_account_lock(account);
        await this.tracking_manager.update_account_table_locks(account);
    }
}
