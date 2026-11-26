import {
    BadRequestException,
    ConflictException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '@app/core/account/account.entity';
import { Session } from '@app/core/session/session.entity';
import { ApiKey } from '@app/core/api-key/api-key.entity';
import { TwoFactor } from '@app/core/two-factor/two-factor.entity';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { AiUsageManager } from '@app/core/ai/ai-usage.manager';
import { MongoDbCollections } from '@app/core/mongodb/collections';
import { ai_allowance, server_budget_micros, usage_month } from '@app/core/ai/ai-plan';
import { account_plan } from '@app/core/plan/plans';
import { admin_actor, AuditAction, AuditDetails } from '@app/core/audit/audit';
import {
    AccountFacts,
    AccountRow,
    AdminInputError,
    E2eResult,
    account_row,
    active_counts,
    admin_plan_name,
    admin_plan_of,
    cap_flags,
    delete_confirmed,
    e2e_result,
    list_accounts,
    lock_reason,
    micros_to_usd,
    parse_account_query,
    plan_change,
    plan_counts,
    signups_per_day,
    SIGNUP_DAYS
} from '@app/core/admin/admin';
import { UsageService } from '../plan/usage.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { AccountService } from '../account/account.service';
import env from '@app/env';
import logger from '@app/logger';

// The accounts' numbers (and the overview built from them) are read again at most this often:
// they come from each account's counters and collection metadata, never a scan of the rows
export const SNAPSHOT_MS = 3 * 60 * 1000;
// The production E2E test's latest run (.github/workflows/e2e.yml), from the public repo
export const E2E_RUNS_URL =
    'https://api.github.com/repos/stevehetz/invokedb/actions/workflows/e2e.yml/runs?per_page=1&status=completed';
export const E2E_CACHE_MS = 5 * 60 * 1000;
// Accounts read at the same time while the snapshot is built
const PARALLEL = 8;
// Audit entries on the account page
const DETAIL_AUDIT_ENTRIES = 20;

interface Snapshot {
    at: number;
    rows: AccountRow[];
}

const time = (d: Date | string | null | undefined): number | null => {
    if (!d) return null;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : null;
};

const bad_input = (ex: unknown) =>
    ex instanceof AdminInputError ? new BadRequestException(ex.message) : ex;

// The admin area (#277): the service's numbers and the accounts, with a few actions on an
// account, each recorded in that account's audit log with the admin as the actor. Never a
// customer's rows: tables are listed by name, row count and size only.
@Injectable()
export class AdminService {
    private snapshot_cache: Snapshot | null = null;
    private snapshot_pending: Promise<Snapshot> | null = null;
    // Bumped by every action, so a build started before one isn't kept or shared
    private snapshot_generation = 0;
    private e2e_cache: { at: number; result: E2eResult } | null = null;

    constructor(
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>,
        @InjectRepository(Session)
        private readonly session_repository: Repository<Session>,
        @InjectRepository(ApiKey)
        private readonly api_key_repository: Repository<ApiKey>,
        @InjectRepository(TwoFactor)
        private readonly two_factor_repository: Repository<TwoFactor>,
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private readonly tracking_manager: TrackingManager,
        private readonly ai_usage_manager: AiUsageManager,
        private readonly collections: MongoDbCollections,
        private readonly usage_service: UsageService,
        private readonly audit_service: AuditService,
        private readonly auth_service: AuthService,
        private readonly account_service: AccountService
    ) {}

    // The clock and GitHub, replaceable in tests
    now: () => number = () => Date.now();
    fetch_e2e: () => Promise<E2eResult> = async () => {
        const res = await fetch(E2E_RUNS_URL, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'invokedb-admin' },
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        return e2e_result(await res.json());
    };

    // ---- Reading ----

    /** The overview page: the service's figures, from the snapshot (a few minutes old at most). */
    async overview() {
        const snap = await this.snapshot();
        const now = this.now();
        const month = usage_month(now);
        const since = new Date(now - SIGNUP_DAYS * 24 * 60 * 60 * 1000);
        // Deleted accounts signed up too
        const created = await this.account_repository
            .createQueryBuilder('a')
            .select('a.created_datetime', 'at')
            .where('a.created_datetime >= :since', { since })
            .getRawMany();
        const budget = server_budget_micros(env.HORIZON_AI_MONTHLY_BUDGET_USD);
        const spent = await this.ai_usage_manager.server_cost(month);
        const sum = (f: (r: AccountRow) => number) => snap.rows.reduce((s, r) => s + f(r), 0);
        return {
            as_of: snap.at,
            month,
            signups: signups_per_day(
                created.map(c => time(c.at)),
                now
            ),
            accounts: snap.rows.length,
            active: active_counts(
                snap.rows.map(r => r.last_active_at),
                now
            ),
            plans: plan_counts(snap.rows),
            tables: sum(r => r.tables),
            rows: sum(r => r.rows),
            storage_bytes: sum(r => r.storage_bytes),
            api_calls: sum(r => r.api_calls),
            ai: {
                spent_usd: micros_to_usd(spent),
                budget_usd: budget > 0 ? micros_to_usd(budget) : null
            },
            over_caps: snap.rows.filter(r => r.caps.some(c => c.level === 'over')).length,
            near_caps: snap.rows.filter(
                r => r.caps.length > 0 && !r.caps.some(c => c.level === 'over')
            ).length,
            e2e: await this.e2e()
        };
    }

    /** The accounts list: `?search=&sort=&dir=&page=&limit=&caps=&plan=`. */
    async accounts(query: any) {
        let q;
        try {
            q = parse_account_query(query);
        } catch (ex) {
            throw bad_input(ex);
        }
        const snap = await this.snapshot();
        return { as_of: snap.at, ...list_accounts(snap.rows, q) };
    }

    /** One account: the list's numbers read fresh, its tables, API keys, history and AI use. */
    async account(id: unknown) {
        const account = await this.live_account(id);
        const now = this.now();
        const month = usage_month(now);
        const usage = await this.usage_service.usage(account.id);
        const plan = account_plan(account);
        const ai = await this.ai_usage_manager.get(account.id, month);
        const allowance = ai_allowance(account);
        const keys = await this.api_key_repository.find({
            where: { account_id: account.id },
            order: { created_datetime: 'DESC' }
        });
        const two_factor = await this.two_factor_repository.countBy({
            account_id: account.id,
            enabled: true
        });
        const sizes = await this.table_sizes(
            account.id,
            usage.tables.map(t => t.id)
        );
        const history = await this.audit_service.list(account.id, null, {
            limit: DETAIL_AUDIT_ENTRIES
        });
        const u = usage.usage;
        const caps = cap_flags(
            {
                tables: u.tables.used,
                rows_per_account: u.rows_per_account.used,
                rows_per_table: u.rows_per_table.used,
                storage_bytes: u.storage_bytes.used,
                api_calls_per_month: u.api_calls_per_month.used
            },
            plan.caps
        );
        const admin_plan = admin_plan_of(plan);
        return {
            account: {
                id: account.id,
                email: account.email,
                name: [account.first_name, account.last_name].filter(Boolean).join(' ') || null,
                plan: admin_plan,
                plan_name:
                    admin_plan === 'INTERNAL'
                        ? `Internal (${plan.plan.name})`
                        : admin_plan_name(admin_plan),
                created_at: time(account.created_datetime),
                last_active_at: await this.last_active(account.id),
                verified: account.email_verified === true,
                two_factor: two_factor > 0,
                password_account: !!account.password_hash,
                locked: account.locked === true,
                locked_reason: account.locked ? account.locked_reason || null : null
            },
            month,
            usage: u,
            caps,
            tables: usage.tables.map(t => ({
                id: t.id,
                name: t.name,
                rows: t.rows,
                columns: t.columns,
                size_bytes: sizes.get(t.id) || 0
            })),
            api_keys: keys.map(k => ({
                id: k.id,
                name: k.name,
                prefix: k.prefix,
                access: k.access,
                tables: k.table_ids === null ? null : (k.table_ids || []).length,
                created_at: time(k.created_datetime),
                last_used_at: time(k.last_used_datetime),
                revoked_at: time(k.revoked_datetime)
            })),
            history: history.entries,
            ai: {
                questions: ai.questions,
                rows: ai.rows,
                input_tokens: ai.input_tokens,
                output_tokens: ai.output_tokens,
                cost_usd: micros_to_usd(ai.cost_micros),
                allowance: {
                    questions: allowance.questions,
                    rows: allowance.rows,
                    budget_usd: micros_to_usd(allowance.budget_micros)
                }
            }
        };
    }

    // ---- Actions (each one in the account's audit log, with the admin as the actor) ----

    async change_plan(admin: Account, id: unknown, body: any) {
        const account = await this.target(admin, id);
        let change;
        try {
            change = plan_change(body && body.plan);
        } catch (ex) {
            throw bad_input(ex);
        }
        const before = admin_plan_of(account_plan(account));
        await this.account_repository.update({ id: account.id }, change);
        const updated = await this.account_repository.findOneBy({ id: account.id });
        const after = admin_plan_of(account_plan(updated));
        // A plan change is when the table cap's lock and the tables' row-cap locks are set or
        // lifted (core/tracking/tracking.manager.ts)
        try {
            await this.tracking_manager.update_account_lock(updated, true);
            await this.tracking_manager.update_account_table_locks(updated);
        } catch (ex) {
            logger.error(`Admin: locks of account ${account.id} not updated: ${ex && ex.message}`);
        }
        await this.record(admin, updated, 'admin.plan_changed', `Changed the plan`, {
            from: admin_plan_name(before),
            to: admin_plan_name(after)
        });
        return { plan: after };
    }

    async lock(admin: Account, id: unknown, body: any) {
        const account = await this.target(admin, id);
        let reason;
        try {
            reason = lock_reason(body && body.reason);
        } catch (ex) {
            throw bad_input(ex);
        }
        await this.account_repository.update(
            { id: account.id },
            { locked: true, locked_reason: reason }
        );
        await this.record(admin, account, 'admin.locked', `Locked the account: ${reason}`, {
            to: reason
        });
        return { locked: true, locked_reason: reason };
    }

    async unlock(admin: Account, id: unknown) {
        const account = await this.target(admin, id);
        if (!account.locked) throw new ConflictException('The account is not locked');
        await this.account_repository.update(
            { id: account.id },
            { locked: false, locked_reason: null }
        );
        await this.record(admin, account, 'admin.unlocked', 'Unlocked the account', {
            from: account.locked_reason || null
        });
        return { locked: false };
    }

    async resend_verification(admin: Account, id: unknown) {
        const account = await this.target(admin, id);
        if (account.email_verified === true) {
            throw new ConflictException('The email address is already verified');
        }
        await this.auth_service.resend_verification(account.id);
        await this.record(
            admin,
            account,
            'admin.verification_sent',
            'Sent a new verification email',
            {}
        );
        return { sent: true };
    }

    async reset_two_factor(admin: Account, id: unknown) {
        const account = await this.target(admin, id);
        // A setup started but never enabled leaves a row with enabled = false: that's still off
        const enabled = await this.two_factor_repository.countBy({
            account_id: account.id,
            enabled: true
        });
        if (!enabled) throw new ConflictException('Two-factor sign-in is off');
        // Removes any pending setup row too
        await this.two_factor_repository.delete({ account_id: account.id });
        await this.record(
            admin,
            account,
            'admin.two_factor_reset',
            'Turned two-factor sign-in off',
            {}
        );
        return { two_factor: false };
    }

    /** The same delete as the user's own (AccountService), then their sessions end. */
    async delete_account(admin: Account, id: unknown, body: any) {
        const account = await this.target(admin, id);
        if (!delete_confirmed(account.email, body && body.confirm)) {
            throw new BadRequestException("Type the account's email address to delete it");
        }
        await this.record(admin, account, 'admin.account_deleted', 'Deleted the account', {});
        await this.account_service.delete_account(account.id);
        await this.session_repository.delete({ account_id: account.id });
        // Again now the account is gone: a build may have started after the audit entry
        this.drop_snapshot();
        return { deleted: true };
    }

    // ---- Helpers ----

    private async record(
        admin: Account,
        account: Account,
        action: AuditAction,
        summary: string,
        details: AuditDetails
    ) {
        logger.info(`Admin ${admin.id} on account ${account.id}: ${action} (${summary})`);
        await this.audit_service.record(account, null, [{ action, summary, details }], {
            actor: admin_actor(admin.email)
        });
        // The list shows the change at once
        this.drop_snapshot();
    }

    /** Forgets the snapshot and any build already running, which read the data before the action. */
    private drop_snapshot() {
        this.snapshot_generation++;
        this.snapshot_cache = null;
        this.snapshot_pending = null;
    }

    private async live_account(id: unknown): Promise<Account> {
        const n = Number(id);
        const account =
            Number.isInteger(n) && n > 0
                ? await this.account_repository.findOneBy({ id: n, deleted: false })
                : null;
        if (!account) throw new NotFoundException('Account not found');
        return account;
    }

    // An admin acts on other accounts; their own goes through the Account page
    private async target(admin: Account, id: unknown): Promise<Account> {
        const account = await this.live_account(id);
        if (account.id === admin.id) {
            throw new HttpException(
                'Use your own Account page for your account',
                HttpStatus.BAD_REQUEST
            );
        }
        return account;
    }

    /** The latest production E2E run, read at most every E2E_CACHE_MS (also the status page's). */
    async e2e(): Promise<E2eResult> {
        const now = this.now();
        if (this.e2e_cache && now - this.e2e_cache.at < E2E_CACHE_MS) return this.e2e_cache.result;
        let result: E2eResult;
        try {
            result = await this.fetch_e2e();
        } catch (ex) {
            logger.warn(`Admin: E2E result not read: ${ex && ex.message}`);
            result = { conclusion: 'unknown', at: null, url: null };
        }
        this.e2e_cache = { at: now, result };
        return result;
    }

    private async last_active(account_id: number): Promise<number | null> {
        const map = await this.last_active_by_account(account_id);
        return map.get(account_id) ?? null;
    }

    // The last sign-in (a session made) or API key call per account
    private async last_active_by_account(account_id?: number) {
        const sessions = this.session_repository
            .createQueryBuilder('s')
            .select('s.account_id', 'account_id')
            .addSelect('MAX(s.created_datetime)', 'at')
            .groupBy('s.account_id');
        const keys = this.api_key_repository
            .createQueryBuilder('k')
            .select('k.account_id', 'account_id')
            .addSelect('MAX(k.last_used_datetime)', 'at')
            .groupBy('k.account_id');
        if (account_id !== undefined) {
            sessions.where('s.account_id = :account_id', { account_id });
            keys.where('k.account_id = :account_id', { account_id });
        }
        const out = new Map<number, number>();
        for (const row of [...(await sessions.getRawMany()), ...(await keys.getRawMany())]) {
            const at = time(row.at);
            const id = Number(row.account_id);
            if (at !== null && at > (out.get(id) ?? -Infinity)) out.set(id, at);
        }
        return out;
    }

    // Each table's size in bytes (its rows' collection), from the collection's own stats
    private async table_sizes(account_id: number, file_ids: number[]) {
        const out = new Map<number, number>();
        if (file_ids.length === 0) return out;
        const db = await this.collections.get_mongo_db(this.collections.get_db_name(account_id));
        await Promise.all(
            file_ids.map(async id => {
                const name = `${this.collections.get_dg_collection_name('data_grid_row', id)}:acct_${account_id}`;
                try {
                    const stats = await db
                        .collection(name)
                        .aggregate([{ $collStats: { storageStats: {} } }])
                        .toArray();
                    out.set(id, Number(stats[0]?.storageStats?.size) || 0);
                } catch {
                    // A table whose collection doesn't exist yet has no size
                    out.set(id, 0);
                }
            })
        );
        return out;
    }

    /** Every live account's numbers, read at most every SNAPSHOT_MS (one build at a time). */
    async snapshot(): Promise<Snapshot> {
        const now = this.now();
        if (this.snapshot_cache && now - this.snapshot_cache.at < SNAPSHOT_MS) {
            return this.snapshot_cache;
        }
        if (!this.snapshot_pending) {
            const generation = this.snapshot_generation;
            const pending: Promise<Snapshot> = this.build_snapshot()
                .then(snap => {
                    // Not kept if an action happened while it was being built
                    if (generation === this.snapshot_generation) this.snapshot_cache = snap;
                    return snap;
                })
                .finally(() => {
                    if (this.snapshot_pending === pending) this.snapshot_pending = null;
                });
            this.snapshot_pending = pending;
        }
        return await this.snapshot_pending;
    }

    private async build_snapshot(): Promise<Snapshot> {
        const at = this.now();
        const month = usage_month(at);
        const accounts = await this.account_repository.findBy({ deleted: false });
        const two_factor = new Set(
            (
                await this.two_factor_repository.find({
                    where: { enabled: true },
                    select: { account_id: true }
                })
            ).map(t => t.account_id)
        );
        const last_active = await this.last_active_by_account();
        const ai_costs = await this.ai_usage_manager.month_costs(month);

        const rows: AccountRow[] = [];
        for (let i = 0; i < accounts.length; i += PARALLEL) {
            const batch = accounts.slice(i, i + PARALLEL);
            rows.push(
                ...(await Promise.all(
                    batch.map(async a => {
                        const facts: AccountFacts = {
                            id: a.id,
                            email: a.email,
                            email_verified: a.email_verified === true,
                            subscription_id: a.subscription_id || null,
                            internal: a.internal === true,
                            locked: a.locked === true,
                            locked_reason: a.locked_reason || null,
                            created_at: time(a.created_datetime),
                            last_active_at: last_active.get(a.id) ?? null,
                            two_factor: two_factor.has(a.id),
                            table_rows: [],
                            storage_bytes: 0,
                            api_calls: 0,
                            ai_cost_micros: ai_costs.get(a.id) || 0
                        };
                        try {
                            facts.table_rows = (
                                await this.tracking_manager.table_row_counts(a)
                            ).map(t => t.rows);
                            facts.storage_bytes = await this.tracking_manager.storage_bytes(a);
                            facts.api_calls = await this.tracking_manager.api_calls_this_month(a);
                        } catch (ex) {
                            logger.error(
                                `Admin: numbers of account ${a.id} not read: ${ex && ex.message}`
                            );
                        }
                        return account_row(facts);
                    })
                ))
            );
        }
        return { at, rows };
    }
}
