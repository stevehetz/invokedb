import { HttpException, Injectable } from '@nestjs/common';
import { Account } from '@app/core/account/account.entity';
import { key_refusal } from '@app/core/api-key/api-key-rules';
import { McpContext, ToolOutcome } from '@app/core/mcp/mcp';
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

    /** A table by name (first, like /api/v1) or id; refused if the key can't use it. */
    private async table(account: Account, ref: string | number, write = false): Promise<Table> {
        const all = (await this.file_dir_service.get_by_account_id(account.id)) || [];
        const files = all.filter(f => f.type === 'file');
        const by_name =
            typeof ref === 'string'
                ? files.find(f => f.name.toLowerCase() === ref.trim().toLowerCase())
                : undefined;
        const id = typeof ref === 'number' ? ref : /^\d+$/.test(ref.trim()) ? Number(ref) : NaN;
        const found = by_name || files.find(f => f.id === id);
        const scope = account.key_scope;
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
