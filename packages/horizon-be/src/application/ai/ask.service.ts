import {
    BadGatewayException,
    BadRequestException,
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
import { QueryColumn, parse_row_query } from '@app/core/web-file/row-query';
import {
    ASK_MAX_TURNS,
    ASK_SAMPLE_ROWS,
    ASK_TOOL_NAME,
    AskError,
    AskQuery,
    api_call,
    ask_columns,
    ask_system_prompt,
    ask_tool,
    parse_ask_input,
    parse_question,
    question_limit,
    reply_text,
    tier_of,
    tool_result_content,
    usage_month
} from '@app/core/ai/ask';
import logger from '@app/logger';

// A run_query call that ran: its body and what it returned
interface RanQuery {
    body: Record<string, unknown>;
    rows: any[];
    total: number;
    fields: string[];
}

export const AI_OFF_MESSAGE = 'AI features are not set up on this server';

// "Ask your data" (#149): a question about one of the account's tables is answered by Claude,
// which reads the table only through run_query, a read-only /api/v1/query body that is checked
// against the table's columns before it runs (core/ai/ask.ts). The reply has the answer, the
// rows behind it and the API call that returns them. Questions are counted per account and
// month and capped by the plan.
@Injectable()
export class AskService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private ai_client: AiClient,
        private ai_usage: AiUsageManager
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

    private async usage(account) {
        const month = usage_month(this.now());
        const used = await this.ai_usage.get(account.id, month);
        return {
            month,
            used: used.questions,
            limit: question_limit(account.subscription_id),
            tier: tier_of(account.subscription_id)
        };
    }

    /** `{ available, usage: { month, used, limit, tier } }` */
    async status(acct_id: number) {
        const account = await this.account(acct_id);
        return { available: this.ai_client.available(), usage: await this.usage(account) };
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

        const month = usage_month(this.now());
        const limit = question_limit(account.subscription_id);
        if (!(await this.ai_usage.reserve(acct_id, month, limit))) {
            throw new HttpException(
                `You've asked all ${limit} questions your plan has this month`,
                HttpStatus.TOO_MANY_REQUESTS
            );
        }

        const samples = await this.samples(acct_id, file.id, columns);
        const system = ask_system_prompt(
            file.name,
            columns,
            samples,
            new Date(this.now()).toISOString().slice(0, 10)
        );
        const tool = ask_tool(columns);
        const messages: any[] = [{ role: 'user', content: question }];
        let last: RanQuery | null = null;
        let answer = '';
        let input_tokens = 0;
        let output_tokens = 0;
        let answered = false;
        try {
            for (let turn = 0; turn < ASK_MAX_TURNS; turn++) {
                // The first turn must query; the last one must answer
                const tool_choice =
                    turn === 0
                        ? { type: 'tool', name: ASK_TOOL_NAME }
                        : turn === ASK_MAX_TURNS - 1
                          ? { type: 'none' }
                          : { type: 'auto' };
                const reply: any = await this.ai_client.create_message({
                    max_tokens: 1024,
                    system,
                    tools: [tool as any],
                    tool_choice: tool_choice as any,
                    messages
                });
                answered = true;
                input_tokens += (reply.usage && reply.usage.input_tokens) || 0;
                output_tokens += (reply.usage && reply.usage.output_tokens) || 0;
                const calls = (reply.content || []).filter(c => c && c.type === 'tool_use');
                if (calls.length === 0) {
                    answer = reply_text(reply.content);
                    break;
                }
                messages.push({ role: 'assistant', content: reply.content });
                const results = [];
                for (const call of calls) {
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
            if (input_tokens || output_tokens) {
                await this.ai_usage.add_tokens(acct_id, month, input_tokens, output_tokens);
            }
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
            usage: await this.usage(account)
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
