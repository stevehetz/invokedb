import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Account } from '@app/core/account/account.entity';
import { Session } from '@app/core/session/session.entity';
import { SessionManager } from '@app/core/session/session.manager';
import {
    DemoIpLimiter,
    demo_busy_error,
    demo_email,
    demo_expires_at,
    demo_ip_error,
    demo_max_live,
    expired_demo_ids,
    is_demo_account
} from '@app/core/demo/demo';
import { AccountDeletionService } from '../account/account-deletion.service';
import { DemoSeedService } from './demo-seed.service';
import env from '@app/env';
import logger from '@app/logger';

const RUN_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_RUN_MS = 2 * 60 * 1000;
// Demo accounts deleted per sweep at most
const SWEEP_PER_RUN = 50;

/**
 * The no-signup demo (#333): `POST /auth/demo` makes a fresh account for a visitor, fills it with
 * the showcase (DemoSeedService) and answers its session, the only way in (no email, no
 * password). At most DEMO_PER_IP_PER_DAY per IP a day and `HORIZON_DEMO_MAX_LIVE` (50) live on
 * the server. The processor deletes each one through AccountDeletionService once it's 24 hours
 * old, hourly.
 */
@Injectable()
export class DemoService implements OnModuleInit, OnModuleDestroy {
    readonly per_ip = new DemoIpLimiter();
    // One demo is made at a time, so the live count can't be passed by parallel requests
    private making: Promise<unknown> = Promise.resolve();
    private sweeping = false;
    private timers: NodeJS.Timeout[] = [];

    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>,
        private readonly session_manager: SessionManager,
        private readonly seed_svc: DemoSeedService,
        private readonly deletion: AccountDeletionService
    ) {}

    now() {
        return Date.now();
    }

    onModuleInit() {
        if (env.IS_HORIZON_PRC) {
            this.timers.push(setInterval(() => this.sweep(), RUN_INTERVAL_MS));
            this.timers.push(setTimeout(() => this.sweep(), FIRST_RUN_MS));
        }
    }

    onModuleDestroy() {
        this.timers.forEach(t => clearTimeout(t));
    }

    /** Live demo accounts: not deleted, not expired. */
    async live_count(now = this.now()) {
        return await this.account_repository.countBy({
            deleted: false,
            demo_expires_at: MoreThan(new Date(now))
        });
    }

    /** Whether the account with this id is a demo account (for DemoGuard). */
    async is_demo(account_id: number) {
        if (!Number.isInteger(account_id) || account_id <= 0) return false;
        const account = await this.account_repository.findOne({
            select: { id: true, email: true, demo_expires_at: true },
            where: { id: account_id }
        });
        return is_demo_account(account);
    }

    /** A new demo account for `ip`, filled: `{ token, expires_at }`. 429 / 503 past the limits. */
    async create(ip: string | undefined) {
        const run = this.making.then(() => this.create_now(ip || 'unknown'));
        this.making = run.catch(() => undefined);
        return await run;
    }

    private async create_now(ip: string) {
        const now = this.now();
        if (!this.per_ip.allowed(ip, now)) throw demo_ip_error();
        if ((await this.live_count(now)) >= demo_max_live(process.env.HORIZON_DEMO_MAX_LIVE)) {
            throw demo_busy_error();
        }

        const expires_at = demo_expires_at(now);
        const account = await this.account_repository.save({
            email: demo_email(),
            password_hash: null,
            first_name: 'Demo',
            last_name: 'Visitor',
            // There's no mailbox to verify; the demo's limits are its own (DEMO_CAPS)
            email_verified: true,
            demo_expires_at: expires_at
        });
        this.per_ip.record(ip, now);
        logger.info(`Demo account ${account.id} made; deleted after ${expires_at.toISOString()}`);

        try {
            await this.seed_svc.seed(account);
        } catch (ex) {
            // The exception filter reports the 500 (#212)
            logger.error(`Demo account ${account.id} not filled: ${ex && ex.message}`);
            await this.remove(account.id);
            throw ex;
        }

        const session = await this.session_manager.create_session(account.id);
        return { token: session.token, expires_at: expires_at.toISOString() };
    }

    // Marked deleted and signed out first, so it's unusable even if the rest fails (the sweep
    // of DeletedAccountService finishes it then)
    private async remove(account_id: number) {
        await this.account_repository.update({ id: account_id }, { deleted: true });
        await this.session_repository.delete({ account_id });
        await this.deletion.delete_account(account_id);
    }

    /** The processor's hourly sweep: deletes expired demo accounts. Answers the ids deleted. */
    async sweep(): Promise<number[]> {
        const done: number[] = [];
        if (this.sweeping) return done;
        this.sweeping = true;
        try {
            const now = this.now();
            const accounts = await this.account_repository.find({
                where: { demo_expires_at: LessThanOrEqual(new Date(now)) },
                select: { id: true, demo_expires_at: true }
            });
            for (const id of expired_demo_ids(accounts, now, SWEEP_PER_RUN)) {
                try {
                    await this.remove(id);
                    done.push(id);
                } catch (ex) {
                    logger.error(`Demo account ${id} not deleted: ${ex && ex.message}`);
                }
            }
            if (done.length > 0) logger.info(`Deleted ${done.length} expired demo account(s)`);
        } catch (ex) {
            logger.error(`Expired demo accounts not checked: ${ex && ex.message}`);
        } finally {
            this.sweeping = false;
        }
        return done;
    }
}
