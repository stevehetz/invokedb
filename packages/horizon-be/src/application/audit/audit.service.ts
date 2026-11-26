import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { Account } from '@app/core/account/account.entity';
import { INTERNAL_EMAILS, PLANS, account_plan, parse_test_plans } from '@app/core/plan/plans';
import { AuditManager } from '@app/core/audit/audit.manager';
import {
    AuditAction,
    AuditActor,
    AuditDetails,
    AuditEntry,
    AuditPageError,
    ColumnChange,
    actor_of,
    audit_cutoff,
    audit_prune_steps,
    encode_audit_cursor,
    new_audit_id,
    parse_audit_page,
    row_change,
    source_of
} from '@app/core/audit/audit';
import env from '@app/env';
import logger from '@app/logger';

// How often the processor deletes entries older than each plan keeps them
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface AuditChange {
    action: AuditAction;
    summary: string;
    details: AuditDetails;
}

// The audit log (#217): records who changed what (rows, columns, tables, API keys) from the app,
// /api/v1 and forms, and lists it per table and per account. Recording never fails the request
// that made the change: an error is logged and the change stands.
@Injectable()
export class AuditService {
    private pruning = false;

    constructor(
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private readonly audit_manager: AuditManager,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>
    ) {
        if (env.IS_HORIZON_PRC) {
            setInterval(() => this.prune(), PRUNE_INTERVAL_MS);
            setTimeout(() => this.prune(), 60 * 1000);
        }
    }

    /**
     * Records changes made by `account` (an /api/v1 caller's carries its key) to table `file_id`
     * (null: account-wide). `actor` overrides who made them (a form). `table_name` saves a lookup.
     */
    async record(
        account: any,
        file_id: number | string | null,
        changes: AuditChange[],
        opts: { actor?: AuditActor; table_name?: string | null } = {}
    ) {
        try {
            const account_id = account && Number(account.id);
            if (!account_id || changes.length === 0) return;
            const id = file_id === null || file_id === undefined ? null : Number(file_id);
            let table_name = opts.table_name ?? null;
            if (id && table_name === null) {
                const file = await this.file_directory_repository.findOneBy({
                    id,
                    account_id
                });
                table_name = file ? file.name : null;
            }
            const actor = opts.actor || actor_of(account);
            const now = Date.now();
            const entries: AuditEntry[] = changes.map(c => ({
                id: new_audit_id(),
                account_id,
                file_id: id,
                table_name,
                action: c.action,
                actor,
                source: source_of(actor),
                summary: c.summary,
                details: c.details,
                created_at: now
            }));
            await this.audit_manager.add(entries);
        } catch (ex) {
            logger.error(`Audit log: changes not recorded: ${ex && ex.message}`);
        }
    }

    /** Row changes: the ids (as strings) of the rows changed and, for updates, the columns. */
    async rows(
        account: any,
        file_id: number | string,
        action: 'row.created' | 'row.updated' | 'row.deleted',
        ids: unknown[],
        columns: string[] = [],
        actor?: AuditActor
    ) {
        const list = (ids || []).filter(id => id !== null && id !== undefined).map(String);
        if (list.length === 0) return;
        await this.record(account, file_id, [{ action, ...row_change(action, list, columns) }], {
            actor
        });
    }

    async columns(account: any, file_id: number | string, changes: ColumnChange[]) {
        await this.record(account, file_id, changes);
    }

    /**
     * `{ entries, next_cursor, keep_days }`: the account's entries, newest first; `table`, only
     * that table's (one of the account's, deleted or not). `query`: `limit`, `cursor`.
     */
    async list(account_id: number, table: unknown, query: any) {
        let page;
        try {
            page = parse_audit_page(query);
        } catch (ex) {
            if (ex instanceof AuditPageError) throw new BadRequestException(ex.message);
            throw ex;
        }
        let file_id: number | null = null;
        if (table !== undefined && table !== null && table !== '') {
            const id = Number(table);
            const file = Number.isInteger(id)
                ? await this.file_directory_repository.findOneBy({ id, account_id })
                : null;
            // Another account's table is "not found", like one that doesn't exist
            if (!file || file.type !== 'file') throw new NotFoundException('Table not found');
            file_id = file.id;
        }
        const docs = await this.audit_manager.page(account_id, file_id, page);
        const entries = docs.slice(0, page.limit);
        const last = entries[entries.length - 1];
        return {
            entries: entries.map(e => {
                const { account_id: _a, ...rest } = e as any;
                return rest;
            }),
            next_cursor: docs.length > page.limit && last ? encode_audit_cursor(last) : null,
            // The account's plan's (#183)
            keep_days: account_plan(await this.account_repository.findOneBy({ id: account_id }))
                .caps.audit_keep_days
        };
    }

    // The accounts that keep entries longer than Free's 7 days: paid plans, internal accounts
    // and test plans (HORIZON_TEST_PLANS). The others are on Free.
    private async longer_retention() {
        const emails = [
            ...INTERNAL_EMAILS,
            ...Object.keys(parse_test_plans(env.HORIZON_TEST_PLANS))
        ];
        const accounts = await this.account_repository.find({
            where: [{ subscription_id: Not(IsNull()) }, { email: In(emails) }, { internal: true }],
            select: {
                id: true,
                email: true,
                email_verified: true,
                subscription_id: true,
                internal: true
            }
        });
        return accounts
            .map(a => ({ account_id: a.id, keep_days: account_plan(a).caps.audit_keep_days }))
            .filter(a => a.keep_days > PLANS.FREE.caps.audit_keep_days);
    }

    async prune() {
        if (this.pruning) return;
        this.pruning = true;
        try {
            const now = Date.now();
            const steps = audit_prune_steps(
                await this.longer_retention(),
                PLANS.FREE.caps.audit_keep_days
            );
            let removed = 0;
            for (const step of steps) {
                removed += await this.audit_manager.prune(
                    audit_cutoff(now, step.days),
                    step.except
                );
            }
            if (removed > 0) logger.info(`Audit log: ${removed} old entries deleted`);
        } catch (ex) {
            logger.error(`Audit log: old entries not deleted: ${ex && ex.message}`);
        } finally {
            this.pruning = false;
        }
    }
}
