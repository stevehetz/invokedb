import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@app/core/account/account.entity';
import { AccountDeletionService } from './account-deletion.service';
import env from '@app/env';
import logger from '@app/logger';

// How often the processor looks for accounts marked deleted whose data is still there
const RUN_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_MS = 5 * 60 * 1000;
// At most this many per run, so a backlog (the accounts deleted before #279) is spread out
export const PURGE_PER_RUN = 50;

/**
 * Which accounts a sweep deletes (#279): only those marked deleted, with a real id, oldest id
 * first, at most `limit`.
 */
export function deleted_account_ids(
    accounts: Array<{ id: unknown; deleted?: unknown }>,
    limit = PURGE_PER_RUN
): number[] {
    return accounts
        .filter(a => a && a.deleted === true && Number.isInteger(a.id) && (a.id as number) > 0)
        .map(a => a.id as number)
        .sort((a, b) => a - b)
        .slice(0, Math.max(0, limit));
}

// Accounts marked deleted (`account.deleted`) but not yet removed: those deleted before #279,
// when deleting only set the flag, and any whose deletion failed half-way. The processor deletes
// their data hourly through AccountDeletionService, which can run again safely. An account is
// read again just before and only deleted if it's still marked deleted.
@Injectable()
export class DeletedAccountService implements OnModuleInit, OnModuleDestroy {
    private running = false;
    private timers: NodeJS.Timeout[] = [];

    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        private readonly deletion: AccountDeletionService
    ) {}

    onModuleInit() {
        if (env.IS_HORIZON_PRC) {
            this.timers.push(setInterval(() => this.run(), RUN_INTERVAL_MS));
            this.timers.push(setTimeout(() => this.run(), FIRST_RUN_MS));
        }
    }

    onModuleDestroy() {
        this.timers.forEach(t => clearTimeout(t));
    }

    /** Deletes the data of accounts marked deleted; answers the ids it deleted. */
    async run(): Promise<number[]> {
        const done: number[] = [];
        if (this.running) return done;
        this.running = true;
        try {
            const accounts = await this.account_repository.find({
                where: { deleted: true },
                select: { id: true, deleted: true }
            });
            for (const id of deleted_account_ids(accounts)) {
                try {
                    const fresh = await this.account_repository.findOne({
                        where: { id },
                        select: { id: true, deleted: true }
                    });
                    if (!fresh || fresh.deleted !== true) continue;
                    logger.info(`Deleted account ${id}: deleting its data`);
                    await this.deletion.delete_account(id);
                    done.push(id);
                } catch (ex) {
                    logger.error(`Deleted account ${id}: data not deleted: ${ex && ex.message}`);
                }
            }
        } catch (ex) {
            logger.error(`Deleted accounts not checked: ${ex && ex.message}`);
        } finally {
            this.running = false;
        }
        return done;
    }
}
