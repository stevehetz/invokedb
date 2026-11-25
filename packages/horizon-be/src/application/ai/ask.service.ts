import {
    BadGatewayException,
    BadRequestException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { AccountService } from '../account/account.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { AiClient } from '@app/core/ai/ai-client';
import { AiUsageManager } from '@app/core/ai/ai-usage.manager';
import { AiSpend } from '@app/core/ai/ai-spend';
import { AiService } from './ai.service';
import { EditPreview, EditService } from './edit.service';
import { QueryColumn, parse_row_query } from '@app/core/web-file/row-query';
import {
    ASK_MAX_TURNS,
    ASK_SAMPLE_ROWS,
    ASK_TOOL_NAME,
    AskError,
    AskQuery,
    PROPOSE_TOOL_NAME,
    api_call,
    ask_columns,
    ask_system_prompt,
    ask_tool,
    parse_ask_input,
    parse_propose_input,
    parse_question,
    propose_tool,
    reply_text,
    tool_result_content
} from '@app/core/ai/ask';
import {
    EDIT_TOOL_NAME,
    EditSpec,
    edit_answer,
    edit_prompt_lines,
    edit_tool,
    parse_edit_input
} from '@app/core/ai/edit';
import {
    AI_OFF_MESSAGE,
    AI_PAUSED_MESSAGE,
    AI_UNVERIFIED_MESSAGE,
    ai_allowance,
    usage_month
} from '@app/core/ai/ai-plan';
import logger from '@app/logger';

// A run_query call that ran: its body and what it returned
interface RanQuery {
    body: Record<string, unknown>;
    rows: any[];
    total: number;
    fields: string[];
}

export { AI_OFF_MESSAGE, AI_PAUSED_MESSAGE, AI_UNVERIFIED_MESSAGE };
// Tells the model to read the table when its first reply didn't
const QUERY_FIRST =
    'Call run_query to read the rows before you answer, propose_rows if I asked for new rows, ' +
    'or propose_edit if I asked to change rows.';

// "Ask your data" (#149): a question about one of the account's tables is answered by Claude,
// which reads the table only through run_query, a read-only /api/v1/query body that is checked
// against the table's columns before it runs (core/ai/ask.ts). The reply has the answer, the
// rows behind it and the API call that returns them. Questions are counted per account and
// month and capped by the plan, by count and by cost, and the whole server has a monthly
// budget (docs/PRICING.md 3.5).
@Injectable()
export class AskService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private ai_client: AiClient,
        private ai_usage: AiUsageManager,
        private ai_spend: AiSpend,
        private ai_service: AiService,
        private edit_service: EditService
    ) {}

    // Overridden by the unit tests
    now() {
        return Date.now();
    }

    private async account(acct_id: number) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        return account;
    }

    /**
     * `{ month, used, limit, tier, verified, budget_used }`: budget_used is the share (0 to 1)
     * of the account's monthly AI budget already spent.
     */
    private async usage(account) {
        const month = usage_month(this.now());
        const used = await this.ai_usage.get(account.id, month);
        const allowance = ai_allowance(account);
        return {
            month,
            used: used.questions,
            limit: allowance.questions,
            tier: allowance.tier,
            verified: allowance.verified,
            budget_used:
                allowance.budget_micros > 0
                    ? Math.min(1, used.cost_micros / allowance.budget_micros)
                    : 1
        };
    }

    /** `{ available, usage }`. Not available without a key and budget, or once it's spent. */
    async status(acct_id: number) {
        const account = await this.account(acct_id);
        const available =
            this.ai_client.available() && !(await this.ai_spend.paused(usage_month(this.now())));
        return { available, usage: await this.usage(account) };
    }

    // A table of the account's that hasn't been deleted
    private async owned_table(acct_id: number, file_id: unknown) {
        if (file_id === null || file_id === undefined || file_id === '') {
            throw new BadRequestException('Pick a table');
        }
        const file = await this.file_directory_svc.assert_owned(acct_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException('Table not found');
        return file;
    }

    // Rows keyed by column name, as /api/v1/query returns them
    private api_rows(docs: any[], fields: QueryColumn[]) {
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

    private async run(acct_id: number, file_id: number, ask: AskQuery) {
        const res = await this.web_file_manager.query_rows(acct_id, file_id, ask.query);
        const docs = res.docs.slice(0, ask.query.limit);
        const total = await this.web_file_manager.count_rows(acct_id, file_id, ask.count_query);
        return { rows: this.api_rows(docs, ask.query.fields), total };
    }

    private async samples(acct_id: number, file_id: number, columns: QueryColumn[]) {
        const query = parse_row_query({ limit: ASK_SAMPLE_ROWS }, columns, ASK_SAMPLE_ROWS);
        const res = await this.web_file_manager.query_rows(acct_id, file_id, query);
        return this.api_rows(res.docs.slice(0, ASK_SAMPLE_ROWS), columns).map(r => {
            const { _id, ...rest } = r;
            return rest;
        });
    }

    /**
     * Body: `{ table: <table id>, question }`. Returns `{ answer, rows, columns, total,
     * api_call: { method, url, body, curl } | null, usage }`.
     */
    async ask(acct_id: number, body: any, base_url: string) {
        const b = body && typeof body === 'object' ? body : {};
        const account = await this.account(acct_id);
        await this.tracking_manager.check_account_lock(account);
        const file = await this.owned_table(acct_id, b.table);
        if (!this.ai_client.available()) throw new ServiceUnavailableException(AI_OFF_MESSAGE);
        const allowance = ai_allowance(account);
        if (!allowance.verified) throw new ForbiddenException(AI_UNVERIFIED_MESSAGE);
        let question: string;
        try {
            question = parse_question(b.question);
        } catch (ex) {
            if (ex instanceof AskError) throw new BadRequestException(ex.message);
            throw ex;
        }
        const col_defs = await this.web_file_manager.get_columns(acct_id, file.id);
        const columns = ask_columns(col_defs);
        if (columns.length === 0) throw new BadRequestException('This table has no columns yet');

        // Read before the question is reserved, so a failed read doesn't use one up
        const samples = await this.samples(acct_id, file.id, columns);

        const month = usage_month(this.now());
        if (await this.ai_spend.paused(month)) {
            throw new ServiceUnavailableException(AI_PAUSED_MESSAGE);
        }
        const limit = allowance.questions;
        if (!(await this.ai_usage.reserve(acct_id, month, limit, allowance.budget_micros))) {
            const used = await this.ai_usage.get(acct_id, month);
            throw new HttpException(
                used.questions >= limit
                    ? `You've asked all ${limit} questions your plan has this month`
                    : "You've used your plan's AI allowance for this month",
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        const system = ask_system_prompt(
            file.name,
            columns,
            samples,
            new Date(this.now()).toISOString().slice(0, 10),
            edit_prompt_lines()
        );
        const tool = ask_tool(columns);
        const tools = [tool as any, propose_tool() as any, edit_tool(columns) as any];
        const messages: any[] = [{ role: 'user', content: question }];
        let last: RanQuery | null = null;
        // Rows the model proposed (#234), not saved: `{ rows, columns, usage }`
        let proposal: { rows: any[]; columns: any[]; usage: any } | null = null;
        // An edit of existing rows the model proposed (#204), not applied
        let edit: EditPreview | null = null;
        let answer = '';
        // Every model call, for charging what it used
        const spent: { model: string; usage: any }[] = [];
        let answered = false;
        try {
            for (let turn = 0; turn < ASK_MAX_TURNS; turn++) {
                // The last turn must answer. Forcing the first one to call the tool isn't
                // possible (current models refuse a forced tool_choice), so the prompt asks for
                // it, and a first reply without a query gets one reminder.
                const tool_choice =
                    turn === ASK_MAX_TURNS - 1 ? { type: 'none' } : { type: 'auto' };
                const { reply, model }: any = await this.ai_client.create_message({
                    max_tokens: 2048,
                    system,
                    tools,
                    tool_choice: tool_choice as any,
                    messages
                });
                answered = true;
                spent.push({ model, usage: reply.usage });
                const calls = (reply.content || []).filter(c => c && c.type === 'tool_use');
                if (calls.length === 0) {
                    if (turn === 0 && ASK_MAX_TURNS > 2) {
                        messages.push({ role: 'assistant', content: reply.content });
                        messages.push({ role: 'user', content: QUERY_FIRST });
                        continue;
                    }
                    answer = reply_text(reply.content);
                    break;
                }
                // Asked for rows (#234): generate a preview and stop. Nothing is saved; the app
                // shows the rows and the user decides. A bad input goes back to the model.
                const propose = calls.find(c => c.name === PROPOSE_TOOL_NAME);
                let bad_propose = '';
                if (propose) {
                    let request: { prompt: string; count: number } | null = null;
                    try {
                        request = parse_propose_input(propose.input);
                    } catch (ex) {
                        if (!(ex instanceof AskError)) throw ex;
                        bad_propose = ex.message;
                    }
                    if (request) {
                        try {
                            proposal = await this.ai_service.preview_rows(account, file, request);
                            const n = proposal.rows.length;
                            answer =
                                `Here ${n === 1 ? 'is 1 new row' : `are ${n} new rows`} for you ` +
                                'to review. Add them to the table, check them, then Save.';
                        } catch (ex) {
                            // Over the row allowance, a locked table, no usable rows: say so
                            if (!(ex instanceof HttpException)) throw ex;
                            answer = ex.message;
                        }
                        break;
                    }
                }
                // Asked to change rows (#204): work the edit out on the rows and stop. Nothing is
                // written; the app shows each changed row and the user applies it or not. A bad
                // spec goes back to the model.
                const propose_edit = calls.find(c => c.name === EDIT_TOOL_NAME);
                let bad_edit = '';
                if (propose_edit) {
                    let spec: EditSpec | null = null;
                    try {
                        spec = parse_edit_input(propose_edit.input, columns);
                    } catch (ex) {
                        if (!(ex instanceof AskError)) throw ex;
                        bad_edit = ex.message;
                    }
                    if (spec) {
                        edit = await this.edit_service.preview(acct_id, file.id, columns, spec);
                        answer = edit_answer(edit.summary, edit.matching, edit.rows.length);
                        if (edit.rows.length === 0) edit = null;
                        break;
                    }
                }
                messages.push({ role: 'assistant', content: reply.content });
                const results = [];
                for (const call of calls) {
                    if (call.name === PROPOSE_TOOL_NAME || call.name === EDIT_TOOL_NAME) {
                        results.push({
                            type: 'tool_result',
                            tool_use_id: call.id,
                            is_error: true,
                            content: call.name === PROPOSE_TOOL_NAME ? bad_propose : bad_edit
                        });
                        continue;
                    }
                    const res = await this.tool_result(acct_id, file.id, columns, call);
                    if (res.ran) last = res.ran;
                    results.push(res.result);
                }
                messages.push({ role: 'user', content: results });
            }
        } catch (ex) {
            if (ex instanceof HttpException) throw ex;
            logger.error(`ai ask failed for acct ${acct_id}: ${ex && ex.message}`);
            // Not the user's fault: the question isn't counted
            if (!answered) await this.ai_usage.release(acct_id, month);
            throw new BadGatewayException("The AI service didn't answer. Please try again.");
        } finally {
            await this.ai_spend.charge(acct_id, month, spent);
        }

        if (!answer) {
            answer = last
                ? `${last.total} row${last.total === 1 ? '' : 's'} match.`
                : "Sorry, I couldn't turn that question into a query of this table.";
        }
        return {
            answer,
            rows: last ? last.rows : [],
            columns: last ? last.fields : [],
            total: last ? last.total : 0,
            api_call: last ? api_call(base_url, file.name, last.body) : null,
            // Rows to review (keyed by field) and their columns, or null
            proposed: proposal ? { rows: proposal.rows, columns: proposal.columns } : null,
            // An edit to review (#204): `{ summary, columns, rows: [{ _id, before, after }],
            // matching, limit, capped }`, or null
            edit,
            usage: await this.usage(account),
            rows_usage: await this.ai_service.rows_usage(account)
        };
    }

    // Runs one run_query call of the model's, or tells it what was wrong with the input
    private async tool_result(
        acct_id: number,
        file_id: number,
        columns: QueryColumn[],
        call: any
    ): Promise<{ result: any; ran: RanQuery | null }> {
        const error = (message: string) => ({
            result: { type: 'tool_result', tool_use_id: call.id, is_error: true, content: message },
            ran: null
        });
        if (call.name !== ASK_TOOL_NAME) return error(`Unknown tool: ${String(call.name)}`);
        let ask: AskQuery;
        try {
            ask = parse_ask_input(call.input, columns);
        } catch (ex) {
            if (ex instanceof AskError) return error(ex.message);
            throw ex;
        }
        const { rows, total } = await this.run(acct_id, file_id, ask);
        return {
            result: {
                type: 'tool_result',
                tool_use_id: call.id,
                content: tool_result_content(total, rows)
            },
            ran: { body: ask.body, rows, total, fields: ask.query.fields.map(c => c.name) }
        };
    }
}
