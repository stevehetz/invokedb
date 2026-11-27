import { HttpException, Injectable } from '@nestjs/common';
import { Account } from '@app/core/account/account.entity';
import { key_refusal } from '@app/core/api-key/api-key-rules';
import { actor_of } from '@app/core/audit/audit';
import {
    McpContext,
    NewColumn,
    new_column_docs,
    TABLE_LIMITED_KEY_REFUSAL,
    ToolOutcome
} from '@app/core/mcp/mcp';
import { MAX_COLUMNS, plan_limit_error } from '@app/core/plan/plans';
import _c from '@app/constants';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { FileDirectoryService } from '@app/application/file-directory/file-directory.service';
import { WebFileService } from '@app/application/web-file/web-file.service';

interface Table {
    id: number;
    name: string;
}

/** Why a tool refused, in words the agent can act on. */
class ToolRefusal extends Error {}

// Runs the MCP server's tools (#305) for an API key's account. Rows go through the same
// WebFileService paths as /api/v1 (quota and rate limit, locks, read-only state, row and
// storage caps, webhooks, audit log with the key as the actor); list_tables and describe_table
// count as one API call each, like any /api/v1 call.
@Injectable()
export class McpService {
    // The last add_columns queued for each table. The HTTP role runs as one process, so an
    // in-memory queue is enough to keep two calls from picking the same new fields.
    private readonly table_queue = new Map<number, Promise<void>>();

    constructor(
        private readonly file_dir_service: FileDirectoryService,
        private readonly web_file_service: WebFileService,
        private readonly web_file_manager: WebFileManager,
        private readonly tracking_manager: TrackingManager
    ) {}

    /** The protocol context for one request made with this API key's account. */
    context(account: Account): McpContext {
        const scope = account.key_scope;
        return {
            access: scope && scope.access === 'read_write' ? 'read_write' : 'read',
            table_limited: table_limited(account),
            run_tool: (name, args) => this.run(account, name, args)
        };
    }

    private async run(
        account: Account,
        name: string,
        args: Record<string, any>
    ): Promise<ToolOutcome> {
        try {
            return { value: await this.call(account, name, args) };
        } catch (ex) {
            if (ex instanceof ToolRefusal) return { error: ex.message };
            // A 4xx the API would answer (bad filter, plan limit, read-only account...): the
            // agent is told why. Anything else is a server error and fails the request.
            if (ex instanceof HttpException && ex.getStatus() < 500) {
                return { error: refusal_text(ex) };
            }
            throw ex;
        }
    }

    private async call(account: Account, name: string, args: Record<string, any>) {
        switch (name) {
            case 'list_tables':
                return await this.list_tables(account);
            case 'describe_table':
                return await this.describe_table(account, args.table);
            case 'query_rows': {
                const table = await this.table(account, args.table);
                const { table: _t, ...body } = args;
                void _t;
                return await this.web_file_service.external_query_rows(
                    account,
                    table.id,
                    body,
                    undefined
                );
            }
            case 'count_rows': {
                const table = await this.table(account, args.table);
                const { table: _t, ...body } = args;
                void _t;
                return await this.web_file_service.external_count_rows(
                    account,
                    table.id,
                    body,
                    undefined
                );
            }
            case 'create_rows': {
                const table = await this.table(account, args.table, true);
                await this.web_file_service.external_create_rows(
                    account,
                    table.id,
                    args.rows,
                    undefined
                );
                return { table: table.name, created: args.rows.length };
            }
            case 'update_rows': {
                const table = await this.table(account, args.table, true);
                const res = await this.web_file_service.external_update_rows(
                    account,
                    table.id,
                    args.rows,
                    undefined
                );
                // A large update runs as a job and answers 'queued'
                return res === 'queued'
                    ? { table: table.name, queued: args.rows.length }
                    : { table: table.name, updated: args.rows.length };
            }
            case 'delete_rows': {
                const table = await this.table(account, args.table, true);
                const deleted = await this.web_file_service.external_delete_rows(
                    account,
                    table.id,
                    args.ids
                );
                return { table: table.name, deleted: typeof deleted === 'number' ? deleted : 0 };
            }
            case 'create_table':
                return await this.create_table(account, args);
            case 'add_columns':
                return await this.add_columns(account, args);
            default:
                throw new ToolRefusal(`Unknown tool: ${name}`);
        }
    }

    // The account's tables this key may use
    private async tables(account: Account): Promise<Table[]> {
        const scope = account.key_scope;
        const all = (await this.file_dir_service.get_by_account_id(account.id)) || [];
        return all
            .filter(f => f.type === 'file')
            .filter(f => !scope || key_refusal(scope, f.id, false) !== 'table')
            .map(f => ({ id: f.id, name: f.name }));
    }

    /**
     * A table by name or id; refused if the key can't use it. Names are unique per folder
     * only, so a name two usable tables share is refused rather than guessed (the agent is
     * asked for the id), and a tool never changes the wrong table.
     */
    private async table(account: Account, ref: string | number, write = false): Promise<Table> {
        const all = (await this.file_dir_service.get_by_account_id(account.id)) || [];
        const files = all.filter(f => f.type === 'file');
        const scope = account.key_scope;
        const named =
            typeof ref === 'string'
                ? files.filter(f => f.name.toLowerCase() === ref.trim().toLowerCase())
                : [];
        const usable_named = named.filter(
            f => !scope || key_refusal(scope, f.id, false) !== 'table'
        );
        if (usable_named.length > 1) {
            throw new ToolRefusal(
                `More than one table is named ${JSON.stringify(ref)}; give its id instead (list_tables shows them)`
            );
        }
        const by_name = usable_named[0] || named[0];
        const id = typeof ref === 'number' ? ref : /^\d+$/.test(ref.trim()) ? Number(ref) : NaN;
        const found = by_name || files.find(f => f.id === id);
        const refusal = found && scope ? key_refusal(scope, found.id, write) : null;
        // Not told apart from a missing table, so a key can't learn names it can't use
        if (!found || refusal === 'table') {
            throw new ToolRefusal(
                `No table ${JSON.stringify(ref)}. list_tables shows the tables you can use.`
            );
        }
        if (refusal === 'read_only') throw new ToolRefusal('This API key is read-only');
        return { id: found.id, name: found.name };
    }

    // One API call, like /api/v1's (the quota, the account's rate limit, a locked account)
    private async count_call(account: Account) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.update_req_count(account);
    }

    private async list_tables(account: Account) {
        await this.count_call(account);
        const tables = await this.tables(account);
        const counts = await this.tracking_manager.table_row_counts(account);
        const names = new Map(tables.map(t => [t.id, t.name]));
        const out = [];
        for (const t of tables) {
            const columns = await this.web_file_manager.get_columns(account.id, t.id);
            out.push({
                id: t.id,
                name: t.name,
                rows: counts.find(c => c.file_id === t.id)?.rows ?? 0,
                columns: describe_columns(columns, names).map(c => ({ name: c.name, type: c.type }))
            });
        }
        return { tables: out };
    }

    // A key for some tables only can't add tables or change columns (#329); handle_message
    // refuses it first, this is the second check
    private assert_schema_access(account: Account) {
        const scope = account.key_scope;
        if (!scope || scope.access !== 'read_write') {
            throw new ToolRefusal('This API key is read-only');
        }
        if (table_limited(account)) throw new ToolRefusal(TABLE_LIMITED_KEY_REFUSAL);
    }

    /**
     * A new table with the agent's columns, made like the app's (FileDirectoryService.create:
     * the table cap, read-only state, email verification, name rules, the audit log), then its
     * columns through WebFileService (column cap, audit log). Everything that can be checked is
     * checked first; if the columns still can't be added, the table is deleted again.
     */
    private async create_table(account: Account, args: Record<string, any>) {
        this.assert_schema_access(account);
        await this.count_call(account);
        await this.tracking_manager.check_not_read_only(account);
        const columns: NewColumn[] = args.columns;
        this.check_column_names([], columns);
        await this.check_column_cap(account, 0, columns.length);
        const parent_id = await this.folder(account, args.folder);
        // Agents address tables by name, so a name used in any folder is refused (the app
        // only refuses one in the same folder)
        const all = (await this.file_dir_service.get_by_account_id(account.id)) || [];
        const wanted = String(args.name).trim().toLowerCase();
        if (all.some(f => f.type === 'file' && f.name.toLowerCase() === wanted)) {
            throw new ToolRefusal(
                `The table name ${JSON.stringify(args.name)} is already in use; choose another name`
            );
        }

        const no_file = true;
        const file = await this.file_dir_service.create(
            account.id,
            { name: args.name, parent_id, type: 'file', web_file_type: 'data-grid' },
            no_file,
            actor_of(account)
        );
        try {
            const docs = new_column_docs(file.id, columns, null, next_field);
            await this.web_file_service.batch_create_internal(
                account,
                file.id,
                _c.MongoDbCollections.data_grid_column,
                docs
            );
        } catch (ex) {
            await this.file_dir_service.batch_delete(account, { ids: [file.id] });
            throw ex;
        }
        return {
            id: file.id,
            name: file.name,
            rows: 0,
            columns: columns.map(c => ({ name: c.name, type: c.type }))
        };
    }

    /** New columns after a table's existing ones, through the same path as the app's. */
    private async add_columns(account: Account, args: Record<string, any>) {
        this.assert_schema_access(account);
        const table = await this.table(account, args.table, true);
        await this.count_call(account);
        // One add_columns per table at a time: the new fields are picked from a read of the
        // columns, so two calls at once would otherwise pick the same fields
        return await this.with_table(table.id, () => this.add_columns_now(account, table, args));
    }

    // Runs fn once every earlier call queued for the same table has finished
    private async with_table<T>(table_id: number, fn: () => Promise<T>): Promise<T> {
        const before = this.table_queue.get(table_id) || Promise.resolve();
        const run = before.then(fn);
        const done = run.then(
            () => undefined,
            () => undefined
        );
        this.table_queue.set(table_id, done);
        try {
            return await run;
        } finally {
            if (this.table_queue.get(table_id) === done) this.table_queue.delete(table_id);
        }
    }

    private async add_columns_now(account: Account, table: Table, args: Record<string, any>) {
        await this.tracking_manager.check_not_read_only(account);
        await this.tracking_manager.check_table_lock(table.id);
        const columns: NewColumn[] = args.columns;
        const all = (await this.web_file_manager.get_all_columns(account.id, table.id)) || [];
        const live = all.filter(c => c.deleted !== true);
        this.check_column_names(live, columns);
        const last = all.length ? all[all.length - 1] : null;
        const max_index = all.reduce((m, c) => Math.max(m, Number(c.col_index) || 0), 0);
        const docs = new_column_docs(
            table.id,
            columns,
            last ? { field: String(last.field), col_index: max_index } : null,
            next_field,
            new Set(all.map(c => String(c.field)))
        );
        // The column cap (403 plan_limit), read-only state, locks and the audit log
        await this.web_file_service.batch_create_internal(
            account,
            table.id,
            _c.MongoDbCollections.data_grid_column,
            docs
        );
        const names = new Map((await this.tables(account)).map(t => [t.id, t.name]));
        return {
            table: table.name,
            added: columns.length,
            columns: describe_columns(
                await this.web_file_manager.get_columns(account.id, table.id),
                names
            )
        };
    }

    // The grid's own column name rules (reserved names, characters, length, no duplicates),
    // before anything is written
    private check_column_names(existing: Record<string, any>[], columns: NewColumn[]) {
        const seen = existing.map(c => ({ headerName: c.headerName }));
        for (const col of columns) {
            this.web_file_manager.validate_column_header(seen, col.name);
            seen.push({ headerName: col.name });
        }
    }

    // The plan's column cap for a table that has `current` columns, as the 403 plan_limit
    // TrackingManager.validate_column_count answers, before a new table is made
    private async check_column_cap(account: Account, current: number, adding: number) {
        const { plan, caps } = await this.tracking_manager.plan(account);
        const cap = Math.min(caps.columns_per_table, MAX_COLUMNS);
        if (current + adding > cap) throw plan_limit_error('columns_per_table', cap, plan);
    }

    // A folder of the account's by id or name (null: the top level)
    private async folder(account: Account, ref: unknown): Promise<number | null> {
        if (ref === undefined || ref === null) return null;
        const all = (await this.file_dir_service.get_by_account_id(account.id)) || [];
        const dirs = all.filter(f => f.type === 'dir');
        let found = [];
        if (typeof ref === 'string' && !/^\d+$/.test(ref.trim())) {
            found = dirs.filter(f => f.name.toLowerCase() === ref.trim().toLowerCase());
        } else {
            found = dirs.filter(f => f.id === Number(ref));
        }
        if (found.length === 0) throw new ToolRefusal(`No folder ${JSON.stringify(ref)}`);
        if (found.length > 1) {
            throw new ToolRefusal(
                `More than one folder is named ${JSON.stringify(ref)}; give its id instead`
            );
        }
        return found[0].id;
    }

    private async describe_table(account: Account, ref: string | number) {
        const table = await this.table(account, ref);
        await this.count_call(account);
        const tables = await this.tables(account);
        const names = new Map(tables.map(t => [t.id, t.name]));
        const columns = await this.web_file_manager.get_columns(account.id, table.id);
        const counts = await this.tracking_manager.table_row_counts(account);
        return {
            id: table.id,
            name: table.name,
            rows: counts.find(c => c.file_id === table.id)?.rows ?? 0,
            columns: describe_columns(columns, names)
        };
    }
}

/** The key is limited to some of the account's tables. */
function table_limited(account: Account): boolean {
    const scope = account.key_scope;
    return !!(scope && Array.isArray(scope.table_ids));
}

const next_field = (field: string) => WebFileManager.prototype.get_next_column_key.call({}, field);

/** A table's columns as an agent sees them: names (the keys of its rows) and types. */
function describe_columns(columns: any[], table_names: Map<number, string>) {
    return (columns || [])
        .filter(c => typeof c.headerName === 'string' && c.headerName.length > 0)
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map(c => {
            const type = c.col_type || 'string';
            const col: Record<string, unknown> = { name: c.headerName, type };
            if (type === 'link') {
                // Cells are arrays of _id values of rows in the linked table (#147)
                col.links_to = table_names.get(Number(c.link_table_id)) ?? null;
            }
            return col;
        });
}

/** An HttpException's answer as text: its message, then any details (a plan limit's cap...). */
function refusal_text(ex: HttpException): string {
    const res = ex.getResponse();
    if (typeof res === 'string') return res;
    const { message, statusCode, error, ...details } = (res || {}) as Record<string, unknown>;
    void statusCode;
    const text = Array.isArray(message)
        ? message.join('; ')
        : String(message ?? error ?? ex.message);
    return Object.keys(details).length ? `${text} ${JSON.stringify(details)}` : text;
}
