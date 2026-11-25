import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { AccountService } from '../account/account.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { Webhook, WebhookDelivery, WebhookManager } from '@app/core/webhook/webhook.manager';
import {
    DeliveryPayload,
    TEST_EVENT,
    WEBHOOK_EVENTS,
    WEBHOOK_LIMITS,
    WebhookError,
    WebhookEvent,
    chunk_rows,
    delivery_body,
    new_id,
    new_secret,
    parse_events,
    parse_test_hosts,
    parse_webhook_url,
    payload_row
} from '@app/core/webhook/webhook';
import env from '@app/env';
import logger from '@app/logger';

// Webhooks on row changes (#140): add, change, test and delete them, read their delivery log,
// and queue deliveries when rows change. The sending happens in the processor
// (WebhookPrcService), so a slow receiver doesn't slow the request that changed the rows.
@Injectable()
export class WebhookService {
    private test_hosts = parse_test_hosts(env.HORIZON_WEBHOOK_TEST_HOSTS);

    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private webhook_manager: WebhookManager
    ) {}

    private checked<T>(fn: () => T): T {
        try {
            return fn();
        } catch (ex) {
            if (ex instanceof WebhookError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    private async unlocked_account(acct_id: number) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        return account;
    }

    // A table of the account's (or null for "every table")
    private async owned_table(acct_id: number, file_id: unknown) {
        if (file_id === null || file_id === undefined || file_id === '') return null;
        const file = await this.file_directory_svc.assert_owned(acct_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException('Table not found');
        return file;
    }

    private async owned(acct_id: number, id: string) {
        const hook = await this.webhook_manager.get(acct_id, id);
        if (!hook) throw new NotFoundException('Webhook not found');
        return hook;
    }

    // What the app sees of a webhook. It's the account's own, so the secret is shown.
    view(hook: Webhook) {
        const { account_id: _a, ...rest } = hook;
        return rest;
    }

    delivery_view(d: WebhookDelivery) {
        const { account_id: _a, body, lease_until: _l, created_date: _c, ...rest } = d as any;
        let payload = null;
        try {
            payload = JSON.parse(body);
        } catch {}
        return { ...rest, payload };
    }

    /** The account's webhooks; with a table id, those that fire for that table. */
    async list(acct_id: number, table?: unknown) {
        const table_file = await this.owned_table(acct_id, table);
        const hooks = await this.webhook_manager.list(acct_id);
        const kept: Webhook[] = [];
        for (const hook of hooks) {
            // A table that's gone takes its webhooks with it
            if (hook.file_id !== null) {
                const file = await this.file_directory_svc.get_by_id(hook.file_id);
                if (!file || file.deleted || file.account_id !== acct_id) {
                    await this.webhook_manager.remove(acct_id, hook.id);
                    continue;
                }
            }
            if (table_file && hook.file_id !== null && hook.file_id !== table_file.id) continue;
            kept.push(hook);
        }
        return { webhooks: kept.map(h => this.view(h)), events: WEBHOOK_EVENTS };
    }

    /** Body: `{ url, events, file_id? (null: every table), enabled? }`. */
    async create(acct_id: number, body: any) {
        const b = body && typeof body === 'object' ? body : {};
        await this.unlocked_account(acct_id);
        const url = this.checked(() => parse_webhook_url(b.url, this.test_hosts));
        const events = this.checked(() => parse_events(b.events));
        const file = await this.owned_table(acct_id, b.file_id);
        if (b.enabled !== undefined && typeof b.enabled !== 'boolean') {
            throw new BadRequestException('enabled must be true or false');
        }
        if ((await this.webhook_manager.count(acct_id)) >= WEBHOOK_LIMITS.max_per_account) {
            throw new ForbiddenException(
                `An account can have at most ${WEBHOOK_LIMITS.max_per_account} webhooks`
            );
        }
        const hook = await this.webhook_manager.create({
            id: new_id('wh'),
            account_id: acct_id,
            file_id: file ? file.id : null,
            url,
            events,
            enabled: b.enabled === undefined ? true : b.enabled,
            secret: new_secret(),
            created_at: Date.now(),
            last_delivery_at: null,
            last_delivery_status: null
        });
        return this.view(hook);
    }

    /** Body: any of `{ url, events, enabled, rotate_secret }`. */
    async update(acct_id: number, id: string, body: any) {
        const hook = await this.owned(acct_id, id);
        const b = body && typeof body === 'object' ? body : {};
        const changes: Partial<Webhook> = {};
        if (b.url !== undefined) {
            changes.url = this.checked(() => parse_webhook_url(b.url, this.test_hosts));
        }
        if (b.events !== undefined) changes.events = this.checked(() => parse_events(b.events));
        if (b.enabled !== undefined) {
            if (typeof b.enabled !== 'boolean') {
                throw new BadRequestException('enabled must be true or false');
            }
            changes.enabled = b.enabled;
        }
        if (b.rotate_secret === true) changes.secret = new_secret();
        if (Object.keys(changes).length === 0) return this.view(hook);
        return this.view(await this.webhook_manager.update(acct_id, hook.id, changes));
    }

    async remove(acct_id: number, id: string) {
        const hook = await this.owned(acct_id, id);
        await this.webhook_manager.remove(acct_id, hook.id);
        return { deleted: hook.id };
    }

    /** Queues a "ping" delivery (sent even if the webhook is disabled). */
    async test(acct_id: number, id: string) {
        const hook = await this.owned(acct_id, id);
        await this.unlocked_account(acct_id);
        let table = null;
        if (hook.file_id !== null) {
            const file = await this.file_directory_svc.get_by_id(hook.file_id);
            if (file && file.account_id === acct_id) table = { id: file.id, name: file.name };
        }
        const [delivery] = this.new_deliveries(hook, TEST_EVENT, table, [[]]);
        await this.webhook_manager.add_deliveries([delivery]);
        return this.delivery_view(delivery);
    }

    async deliveries(acct_id: number, id: string) {
        const hook = await this.owned(acct_id, id);
        const list = await this.webhook_manager.deliveries(acct_id, hook.id);
        return { deliveries: list.map(d => this.delivery_view(d)) };
    }

    private new_deliveries(
        hook: Webhook,
        event: WebhookEvent | typeof TEST_EVENT,
        table: DeliveryPayload['table'],
        chunks: any[][]
    ): WebhookDelivery[] {
        const now = Date.now();
        return chunks.map(rows => {
            const id = new_id('whd');
            const body = delivery_body({
                id,
                event,
                created_at: new Date(now).toISOString(),
                webhook_id: hook.id,
                table,
                rows
            });
            return {
                id,
                webhook_id: hook.id,
                account_id: hook.account_id,
                file_id: table ? table.id : null,
                event,
                body,
                rows: rows.length,
                status: 'pending',
                attempts: 0,
                attempt_log: [],
                next_attempt_at: now,
                lease_until: null,
                created_at: now,
                created_date: new Date(now),
                delivered_at: null
            };
        });
    }

    /** True if an enabled webhook wants `event` on the table (never throws). */
    async wants(acct_id: number, file_id, event: WebhookEvent) {
        try {
            const id = Number(file_id);
            if (!Number.isInteger(id)) return false;
            return (await this.webhook_manager.matching(acct_id, id, event)).length > 0;
        } catch (ex) {
            logger.error(`Webhooks of file ${file_id} not read: ${ex && ex.message}`);
            return false;
        }
    }

    /**
     * Queues a delivery to every enabled webhook that wants `event` on the table, for rows
     * changed through the app or /api/v1. `docs` are the rows as stored (fields, not column
     * names); a deleted row is just its `_id`. Never throws: a webhook problem mustn't fail the
     * change that was already made.
     */
    async emit(acct_id: number, file_id, event: WebhookEvent, docs: any[]) {
        try {
            const id = Number(file_id);
            if (!acct_id || !Number.isInteger(id) || !Array.isArray(docs) || docs.length === 0) {
                return;
            }
            const hooks = await this.webhook_manager.matching(acct_id, id, event);
            if (hooks.length === 0) return;
            const file = await this.file_directory_svc.get_by_id(id);
            if (!file || file.account_id !== acct_id) return;
            let rows;
            if (event === 'row.deleted') {
                rows = docs.map(d => ({ _id: String(d._id !== undefined ? d._id : d) }));
            } else {
                const cols = await this.web_file_manager.get_all(acct_id, id, 'data_grid_column');
                const columns = (cols && cols.data) || [];
                // Dates as the API shows them (a new row's are still Date objects)
                const date = (v: any) =>
                    v instanceof Date ? this.web_file_manager.format_date_field(v) : v;
                rows = docs.filter(Boolean).map(d => payload_row(d, columns, date));
            }
            const chunks = chunk_rows(rows);
            const table = { id: file.id, name: file.name };
            const deliveries = hooks.flatMap(h => this.new_deliveries(h, event, table, chunks));
            await this.webhook_manager.add_deliveries(deliveries);
        } catch (ex) {
            logger.error(`Webhook ${event} for file ${file_id} not queued: ${ex && ex.message}`);
        }
    }
}
