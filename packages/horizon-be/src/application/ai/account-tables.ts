import { FileDirectoryService } from '../file-directory/file-directory.service';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { QueryColumn } from '@app/core/web-file/row-query';
import {
    ASK_MAX_ROWS,
    ASK_PROMPT_MAX_TABLES,
    ASK_TOOL_NAME,
    AskError,
    AskQuery,
    PromptTables,
    ask_columns,
    parse_ask_input,
    prompt_tables,
    resolve_ask_table,
    tool_result_content
} from '@app/core/ai/ask';

// A run_query call that ran: its body and what it returned
export interface RanQuery {
    // The name of the table read (#322: the current one or another of the account's)
    table: string;
    body: Record<string, unknown>;
    rows: any[];
    total: number;
    fields: string[];
}

// The tables a run_query call can read (#322): the caller's own live tables only, with the
// columns of those already looked up. `current` is the table read when the input names none;
// a table from a description (#324) has none, so its input must name one.
export interface ReadableTables {
    current: { id: number; name: string } | null;
    tables: { id: number; name: string }[];
    known: Map<number, QueryColumn[]>;
}

/**
 * Reading the caller's own tables for the AI (#322, #324): listing them for a prompt and running
 * the model's run_query calls, read-only, each checked against its table's columns. Used by Ask
 * AI and by "New table from a description". Never reads another account's tables: the list is
 * the session account's own, and a table is only ever picked from it.
 */
export class AccountTables {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private web_file_manager: WebFileManager
    ) {}

    /**
     * The account's live tables (run_query's table input picks one of them), and those but
     * `exclude_id` (by name) with their columns, capped for the prompt.
     */
    async list(
        acct_id: number,
        exclude_id: number | null = null
    ): Promise<{ tables: { id: number; name: string }[]; prompt: PromptTables }> {
        const files = ((await this.file_directory_svc.get_by_account_id(acct_id)) || []).filter(
            f => f && f.type === 'file' && !f.deleted && f.account_id === acct_id
        );
        const others = files
            .filter(f => f.id !== exclude_id)
            .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const listed = [];
        for (const t of others.slice(0, ASK_PROMPT_MAX_TABLES)) {
            const columns = ask_columns(await this.web_file_manager.get_columns(acct_id, t.id));
            listed.push({ name: t.name, columns });
        }
        return { tables: files, prompt: prompt_tables(listed, others.length) };
    }

    // Rows keyed by column name, as /api/v1/query returns them
    api_rows(docs: any[], fields: QueryColumn[]) {
        return docs.map(doc => {
            const row: any = { _id: doc._id };
            fields.forEach(c => {
                const value = doc[c.field] === undefined ? null : doc[c.field];
                row[c.name] =
                    c.type === 'date' && value
                        ? this.web_file_manager.format_date_field(value)
                        : value;
            });
            return row;
        });
    }

    async run(acct_id: number, file_id: number, ask: AskQuery) {
        const res = await this.web_file_manager.query_rows(acct_id, file_id, ask.query);
        const docs = res.docs.slice(0, ask.query.limit);
        const total = await this.web_file_manager.count_rows(acct_id, file_id, ask.count_query);
        return { rows: this.api_rows(docs, ask.query.fields), total };
    }

    /**
     * Runs one run_query call of the model's, or tells it what was wrong with the input. At most
     * `max_rows` rows are read.
     */
    async tool_result(
        acct_id: number,
        readable: ReadableTables,
        call: any,
        max_rows = ASK_MAX_ROWS
    ): Promise<{ result: any; ran: RanQuery | null }> {
        const error = (message: string) => ({
            result: { type: 'tool_result', tool_use_id: call.id, is_error: true, content: message },
            ran: null
        });
        if (call.name !== ASK_TOOL_NAME) return error(`Unknown tool: ${String(call.name)}`);
        let ask: AskQuery;
        let table: { id: number; name: string };
        try {
            // Another of the account's tables (#322), by name, or the current one
            table = resolve_ask_table(call.input, readable.tables) || readable.current;
            if (!table) throw new AskError('Give the name of the table to read in table');
            let columns = readable.known.get(table.id);
            if (!columns) {
                columns = ask_columns(await this.web_file_manager.get_columns(acct_id, table.id));
                readable.known.set(table.id, columns);
            }
            if (columns.length === 0) {
                throw new AskError(`The table ${JSON.stringify(table.name)} has no columns yet`);
            }
            ask = parse_ask_input(call.input, columns, max_rows);
        } catch (ex) {
            if (ex instanceof AskError) return error(ex.message);
            throw ex;
        }
        const { rows, total } = await this.run(acct_id, table.id, ask);
        return {
            result: {
                type: 'tool_result',
                tool_use_id: call.id,
                content: tool_result_content(total, rows)
            },
            ran: {
                table: table.name,
                body: ask.body,
                rows,
                total,
                fields: ask.query.fields.map(c => c.name)
            }
        };
    }
}
