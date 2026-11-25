import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { MarkableStep, OnboardingState, STEP_FIELDS } from './onboarding';
import env from '@app/env';
import logger from '@app/logger';

const STATE_ID: any = 'state';

// The onboarding checklist's state (#143): one document per account, in the tracking database
// next to the account's limits and request counts.
@Injectable()
export class OnboardingManager {
    // Accounts whose API call is already recorded, so /api/v1 calls skip the write after that
    private api_call_recorded = new Set<number>();
    // Likewise for the first table (#169)
    private table_created_recorded = new Set<number>();

    constructor(private _collections: MongoDbCollections) {}

    private async collection(account_id: number) {
        return await this._collections.get_collection(account_id, 'tracking:onboarding', {
            db_name: env.HORIZON_MONGO_TRACKING_DB,
            mongo_uri: env.HORIZON_MONGO_TRACKING_URI
        });
    }

    async get_state(account_id: number): Promise<OnboardingState> {
        const c = await this.collection(account_id);
        const doc = await c.findOne({ _id: STATE_ID });
        if (!doc) return {};
        const { key_viewed_at, command_copied_at, api_called_at, dismissed_at } = doc;
        return { key_viewed_at, command_copied_at, api_called_at, dismissed_at };
    }

    // $min keeps the first time, so marking a step again changes nothing. The fixed _id keeps it
    // one document even if two upserts race (the server retries the loser as an update).
    private async set_once(account_id: number, field: keyof OnboardingState) {
        const c = await this.collection(account_id);
        await c.updateOne({ _id: STATE_ID }, { $min: { [field]: Date.now() } }, { upsert: true });
    }

    async mark(account_id: number, step: MarkableStep) {
        await this.set_once(account_id, STEP_FIELDS[step]);
    }

    async dismiss(account_id: number) {
        await this.set_once(account_id, 'dismissed_at');
    }

    // The funnel's times (#169). Signup, verification and making a table must not fail because
    // the tracking database did, so these only log.
    private async record_quietly(account_id: number, field: keyof OnboardingState) {
        if (!account_id) return;
        try {
            await this.set_once(account_id, field);
        } catch (err) {
            logger.warn(`Could not record onboarding ${field} for account ${account_id}: ${err}`);
        }
    }

    async record_signup(account_id: number) {
        await this.record_quietly(account_id, 'signed_up_at');
    }

    async record_email_verified(account_id: number) {
        await this.record_quietly(account_id, 'email_verified_at');
    }

    async record_table_created(account_id: number) {
        if (this.table_created_recorded.has(account_id)) return;
        await this.record_quietly(account_id, 'table_created_at');
        this.table_created_recorded.add(account_id);
    }

    async record_api_call(account_id: number) {
        if (!account_id || this.api_call_recorded.has(account_id)) return;
        await this.set_once(account_id, 'api_called_at');
        this.api_call_recorded.add(account_id);
    }
}
