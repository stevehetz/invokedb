import {
    BadRequestException,
    Injectable,
    NotFoundException,
    OnModuleDestroy,
    OnModuleInit
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@app/core/account/account.entity';
import { PlanStateCheck, TrackingManager } from '@app/core/tracking/tracking.manager';
import {
    PLAN_SUBSCRIPTIONS,
    parse_test_plans,
    set_runtime_test_plan,
    test_plan_emails
} from '@app/core/plan/plans';
import {
    PlanState,
    grace_end,
    grace_ended,
    next_plan_state,
    over_caps,
    parse_plan_state
} from '@app/core/plan/plan-state';
import { UsageService } from './usage.service';
import env from '@app/env';
import logger from '@app/logger';

// How often the processor works out every account's state again (a plan change, #129, does it
// for its own account at once)
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_SWEEP_MS = 10 * 60 * 1000;

// The plan state of accounts (#184, core/plan/plan-state.ts): works it out from what an account
// holds against its plan's caps, stores it, ends grace periods, and answers TrackingManager when
// a read-only account tries to write (so deleting down to the caps lifts it at once). It only
// ever writes `plan_state` (and, when a grace period ends, the plan): never the `locked` flag.
@Injectable()
export class PlanStateService implements OnModuleInit, OnModuleDestroy {
    private sweeping = false;
    private timers: NodeJS.Timeout[] = [];

    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        private readonly usage_service: UsageService,
        private readonly tracking_manager: TrackingManager
    ) {}

    // The clock, replaceable in tests
    now: () => number = () => Date.now();

    onModuleInit() {
        this.tracking_manager.set_plan_state_refresher(id => this.refresh(id));
        if (env.IS_HORIZON_PRC) {
            this.timers.push(setInterval(() => this.sweep(), SWEEP_INTERVAL_MS));
            this.timers.push(setTimeout(() => this.sweep(), FIRST_SWEEP_MS));
        }
    }

    onModuleDestroy() {
        this.timers.forEach(t => clearTimeout(t));
    }

    /**
     * Works out account `account_id`'s state again and stores it when it changed. A grace
     * period that has ended puts the account on Free first (and starts its idle clock, as a
     * lapse does).
     */
    async refresh(account_id: number): Promise<PlanStateCheck> {
        const account = await this.account_repository.findOneBy({ id: account_id });
        if (!account || account.deleted) return { state: 'active', over: [], changed: false };
        const now = this.now();
        let current = parse_plan_state(account.plan_state);
        if (grace_ended(current, account.grace_ends_at, now)) {
            await this.account_repository.update(
                { id: account.id },
                {
                    subscription_id: PLAN_SUBSCRIPTIONS.FREE,
                    plan_state: 'active',
                    grace_ends_at: null,
                    idle_clock_at: new Date(now)
                }
            );
            logger.info(`Account ${account.id}: grace period over, now on Free`);
            current = 'active';
        }
        const usage = await this.usage_service.usage(account.id);
        const over = over_caps(usage.usage);
        const next = next_plan_state(current, account.grace_ends_at, over, now);
        if (next !== current) {
            await this.account_repository.update({ id: account.id }, { plan_state: next });
            const why = over.length > 0 ? ` (over: ${over.join(', ')})` : '';
            logger.info(`Account ${account.id}: plan state ${current} -> ${next}${why}`);
        }
        return { state: next, over, changed: next !== parse_plan_state(account.plan_state) };
    }

    /**
     * Starts a 14-day grace period (a failed payment; Stripe's webhook, #129): full access
     * until it ends, then Free.
     */
    async start_grace(account_id: number): Promise<PlanState> {
        const account = await this.account_repository.findOneBy({ id: account_id });
        if (!account || account.deleted) throw new NotFoundException();
        await this.account_repository.update(
            { id: account.id },
            { plan_state: 'grace', grace_ends_at: grace_end(this.now()) }
        );
        logger.info(`Account ${account.id}: grace period started`);
        return 'grace';
    }

    /**
     * Every account's state, worked out again. Accounts listed in HORIZON_TEST_PLANS (the smoke
     * stack's) are left to the smoke test, which sets theirs itself.
     */
    async sweep() {
        if (this.sweeping) return;
        this.sweeping = true;
        try {
            const skip = new Set(test_plan_emails());
            const accounts = await this.account_repository.find({
                where: { deleted: false },
                select: { id: true, email: true }
            });
            let changed = 0;
            for (const a of accounts) {
                if (skip.has(String(a.email || '').toLowerCase())) continue;
                try {
                    if ((await this.refresh(a.id)).changed) changed++;
                } catch (ex) {
                    logger.error(`Plan state of account ${a.id} not checked: ${ex && ex.message}`);
                }
            }
            if (changed > 0) logger.info(`Plan states: ${changed} changed`);
        } catch (ex) {
            logger.error(`Plan states not checked: ${ex && ex.message}`);
        } finally {
            this.sweeping = false;
        }
    }

    /**
     * Test only (`PUT /test-plan`, #184): puts the caller, an account HORIZON_TEST_PLANS lists,
     * on another plan (`body` as one of its entries; null: back to its listed plan), as a
     * downgrade would, and works out its state. A 404 for anyone else, and always in
     * production, where HORIZON_TEST_PLANS is never set.
     */
    async set_test_plan(account_id: number, body: any | null) {
        if (!env.HORIZON_TEST_PLANS) throw new NotFoundException();
        const account = await this.account_repository.findOneBy({ id: account_id });
        const email = String((account && account.email) || '').toLowerCase();
        if (!account || !test_plan_emails().includes(email)) throw new NotFoundException();
        if (body === null) {
            set_runtime_test_plan(email, null);
        } else {
            const entry = parse_test_plans(JSON.stringify({ [email]: body }))[email];
            if (!entry) throw new BadRequestException('plan must be FREE, STARTER or PRO');
            set_runtime_test_plan(email, entry);
        }
        const { state, over } = await this.refresh(account.id);
        return { plan_state: state, over };
    }
}
