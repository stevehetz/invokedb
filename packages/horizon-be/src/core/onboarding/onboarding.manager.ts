import { Injectable } from '@nestjs/common';
import { MongoDbCollections } from '../mongodb/collections';
import { MarkableStep, OnboardingState, STEP_FIELDS } from './onboarding';
import env from '@app/env';

const STATE_ID: any = 'state';

// The onboarding checklist's state (#143): one document per account, in the tracking database
// next to the account's limits and request counts.
@Injectable()
export class OnboardingManager {
    // Accounts whose API call is already recorded, so /api/v1 calls skip the write after that
    private api_call_recorded = new Set<number>();

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

    async record_api_call(account_id: number) {
        if (!account_id || this.api_call_recorded.has(account_id)) return;
        await this.set_once(account_id, 'api_called_at');
        this.api_call_recorded.add(account_id);
    }
}
