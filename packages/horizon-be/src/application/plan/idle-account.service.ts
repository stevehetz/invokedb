import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@app/core/account/account.entity';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { EmailManager } from '@app/email/email.manager';
import { IdleAccount, idle_decision, idle_warning_email } from '@app/core/plan/idle';
import { AccountDeletionService } from '../account/account-deletion.service';
import env from '@app/env';
import logger from '@app/logger';

// How often the processor looks for idle free accounts
const RUN_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_MS = 5 * 60 * 1000;

const IDLE_FIELDS = {
    id: true,
    email: true,
    email_verified: true,
    // An account an admin made internal (#277) is never idle-deleted
    internal: true,
    subscription_id: true,
    deleted: true,
    last_sign_in_at: true,
    last_api_call_at: true,
    idle_clock_at: true,
    idle_warned_at: true,
    idle_final_warned_at: true
} as const;

export interface IdleRunResult {
    warned_first: number[];
    warned_final: number[];
    deleted: number[];
}

// Idle free accounts (#184, core/plan/idle.ts): the processor sends the two warnings and then
// deletes the account with all its data. Safe to run again at any time: every step is decided
// from what's stored, an account is read again just before it's deleted and only deleted if it
// is still free, idle and warned twice, and a warning is only recorded once it was sent (with
// no way to send email, nobody is warned, so nobody is deleted). Every warning and deletion is
// logged.
@Injectable()
export class IdleAccountService implements OnModuleInit, OnModuleDestroy {
    private running = false;
    private timers: NodeJS.Timeout[] = [];

    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private readonly email_manager: EmailManager,
        private readonly deletion: AccountDeletionService
    ) {}

    // The clock, replaceable in tests
    now: () => number = () => Date.now();

    onModuleInit() {
        if (env.IS_HORIZON_PRC) {
            this.timers.push(setInterval(() => this.run(), RUN_INTERVAL_MS));
            this.timers.push(setTimeout(() => this.run(), FIRST_RUN_MS));
        }
    }

    onModuleDestroy() {
        this.timers.forEach(t => clearTimeout(t));
    }

    // Mailgun in production; in local mode the emails go to the log
    private can_send() {
        return this.email_manager.is_configured || !!env.IS_LOCAL;
    }

    async run(): Promise<IdleRunResult> {
        const result: IdleRunResult = { warned_first: [], warned_final: [], deleted: [] };
        if (this.running) return result;
        this.running = true;
        try {
            const now = this.now();
            const accounts = await this.account_repository.find({
                where: { deleted: false },
                select: IDLE_FIELDS
            });
            for (const a of accounts) {
                try {
                    const d = idle_decision(a as IdleAccount, now);
                    if (d.action === 'warn_first' || d.action === 'warn_final') {
                        const final = d.action === 'warn_final';
                        if (await this.warn(a, final, d.idle_since, d.delete_at, now)) {
                            (final ? result.warned_final : result.warned_first).push(a.id);
                        }
                    } else if (d.action === 'delete') {
                        if (await this.delete_if_still_idle(a.id, now)) result.deleted.push(a.id);
                    }
                } catch (ex) {
                    logger.error(`Idle account ${a.id} not handled: ${ex && ex.message}`);
                }
            }
        } catch (ex) {
            logger.error(`Idle accounts not checked: ${ex && ex.message}`);
        } finally {
            this.running = false;
        }
        return result;
    }

    private async warn(
        a: Account,
        final: boolean,
        idle_since: number,
        delete_at: number,
        now: number
    ): Promise<boolean> {
        if (!this.can_send()) {
            logger.error(`Idle account ${a.id} not warned: email isn't configured`);
            return false;
        }
        const tables = await this.file_directory_repository.countBy({
            account_id: a.id,
            type: 'file',
            deleted: false
        });
        const { subject, text } = idle_warning_email({
            final,
            email: a.email,
            idle_since,
            delete_at,
            tables,
            sign_in_url: `${(env.HORIZON_FE_PUB_HTTP_URL || '').replace(/\/$/, '')}/login`
        });
        if (this.email_manager.is_configured) {
            await this.email_manager.send_text(a.email, subject, text);
        } else {
            logger.info(
                `[email skipped: no MAILGUN_API_KEY] to=${a.email} subject=${subject}\n${text}`
            );
        }
        const at = new Date(now);
        await this.account_repository.update(
            { id: a.id },
            final
                ? { idle_final_warned_at: at }
                : { idle_warned_at: at, idle_final_warned_at: null }
        );
        logger.info(
            `Idle account ${a.id}: ${final ? 'final' : 'first'} warning sent, to be deleted on ` +
                new Date(delete_at).toISOString().slice(0, 10)
        );
        return true;
    }

    // Read again, decided again: only a free account still idle and warned twice is deleted
    private async delete_if_still_idle(account_id: number, now: number): Promise<boolean> {
        const fresh = await this.account_repository.findOne({
            where: { id: account_id },
            select: IDLE_FIELDS
        });
        if (!fresh) return false;
        const d = idle_decision(fresh as IdleAccount, now);
        if (d.action !== 'delete') return false;
        logger.info(
            `Idle account ${account_id}: deleting (idle since ` +
                `${new Date(d.idle_since).toISOString()}, warned ` +
                `${new Date(fresh.idle_warned_at).toISOString()} and ` +
                `${new Date(fresh.idle_final_warned_at).toISOString()})`
        );
        await this.deletion.delete_account(account_id);
        return true;
    }
}
