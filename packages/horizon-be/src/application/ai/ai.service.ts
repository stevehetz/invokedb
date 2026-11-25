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
import { TableTemplateService } from '../table-template/table-template.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { AiClient, AiModelError } from '@app/core/ai/ai-client';
import { AiUsageManager } from '@app/core/ai/ai-usage.manager';
import { AiSpend } from '@app/core/ai/ai-spend';
import { ai_allowance, usage_month } from '@app/core/ai/ai-plan';
import {
    AI_LIMITS,
    AiColumn,
    AiError,
    ROWS_SYSTEM,
    TABLE_SYSTEM,
    ai_columns,
    batch_sizes,
    check_rows,
    check_table_design,
    design_columns,
    max_tokens_for,
    parse_rows_request,
    parse_table_request,
    rows_prompt,
    rows_schema,
    sample_rows,
    table_prompt,
    table_schema
} from '@app/core/ai/ai';
import { validate_template } from '@app/core/table-template/table-template';
import { assert_verified } from '@app/core/email-verification/email-verification';
import { AI_OFF_MESSAGE, AI_PAUSED_MESSAGE } from './ask.service';
import logger from '@app/logger';

// One model call's usage, for charging it
interface Spent {
    model: string;
    usage: any;
}

// AI-generated rows and tables (#148). Nothing here writes rows: "Generate rows" answers a
// preview that the app inserts through the ordinary row route (row limit, locks, webhooks), and
// "New table from a description" answers a design that `create_table` makes like a template.
// Every generated row counts against the account's monthly allowance, and every call's cost
// against its dollar budget and the server's (docs/PRICING.md 3.5, core/ai/ai-plan.ts).
@Injectable()
export class AiService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private table_template_svc: TableTemplateService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private ai_client: AiClient,
        private ai_usage: AiUsageManager,
        private ai_spend: AiSpend
    ) {}

    // Overridden by the unit tests
    now() {
        return Date.now();
    }

    private checked<T>(fn: () => T): T {
        try {
            return fn();
        } catch (ex) {
            if (ex instanceof AiError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    private assert_enabled() {
        if (!this.ai_client.available()) throw new ServiceUnavailableException(AI_OFF_MESSAGE);
    }

    private async account(acct_id: number) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        return account;
    }

    /** The caller's account, refused (403) until its email is verified (#132): calls cost money. */
    private async verified_account(acct_id: number) {
        const account = await this.account(acct_id);
        assert_verified(account);
        return account;
    }

    /** `{ month, used, limit }`: generated rows this month. */
    async rows_usage(account) {
        const month = usage_month(this.now());
        const used = await this.ai_usage.get(account.id, month);
        return { month, used: used.rows, limit: ai_allowance(account).rows };
    }

    /** Takes `rows` of this month's allowance, or answers 429 (503 when AI is paused). */
    private async reserve(account, rows: number) {
        const month = usage_month(this.now());
        if (await this.ai_spend.paused(month)) {
            throw new ServiceUnavailableException(AI_PAUSED_MESSAGE);
        }
        const allowance = ai_allowance(account);
        if (
            await this.ai_usage.reserve_rows(
                account.id,
                month,
                rows,
                allowance.rows,
                allowance.budget_micros
            )
        ) {
            return month;
        }
        const used = await this.ai_usage.get(account.id, month);
        const left = Math.max(0, allowance.rows - used.rows);
        throw new HttpException(
            used.cost_micros >= allowance.budget_micros
                ? "You've used your plan's AI allowance for this month. It renews on the 1st."
                : left === 0
                  ? `This month's ${allowance.rows} AI rows are used up. They renew on the 1st.`
                  : `Only ${left} of this month's ${allowance.rows} AI rows are left. Ask for fewer.`,
            HttpStatus.TOO_MANY_REQUESTS
        );
    }

    // One model call; its usage goes into `spent` whether or not its answer can be used
    private async call(request: Parameters<AiClient['json']>[0], spent: Spent[]) {
        try {
            const res = await this.ai_client.json(request);
            spent.push({ model: res.model, usage: res.usage });
            return res.data;
        } catch (ex) {
            logger.error(`AI call failed: ${ex && ex.message}`);
            if (ex instanceof AiModelError) {
                if (ex.usage) spent.push({ model: ex.model, usage: ex.usage });
                throw new BadGatewayException(ex.message);
            }
            throw new BadGatewayException("The AI didn't answer. Try again in a minute.");
        }
    }

    /**
     * `count` rows for `columns`, in parallel model calls of at most rows_per_call rows. Never
     * throws for a failed call: it answers the rows of the calls that worked, `sent` (the rows
     * asked of the model, which count against the allowance, usable or not) and the first
     * call's error. After a failed call no new calls are started.
     */
    private async generate(
        columns: AiColumn[],
        samples: any[],
        prompt: string,
        count: number,
        spent: Spent[],
        key_of?: (c: AiColumn) => string
    ): Promise<{ rows: any[]; sent: number; error: unknown }> {
        const schema = rows_schema(columns);
        const sizes = batch_sizes(count);
        const results: any[][] = new Array(sizes.length);
        let next = 0;
        let sent = 0;
        let error: unknown = null;
        const worker = async () => {
            while (next < sizes.length && !error) {
                const i = next++;
                sent += sizes[i];
                try {
                    const raw = await this.call(
                        {
                            system: ROWS_SYSTEM,
                            prompt: rows_prompt(columns, samples, prompt, sizes[i], {
                                index: i,
                                of: sizes.length
                            }),
                            schema,
                            max_tokens: max_tokens_for(sizes[i], columns.length)
                        },
                        spent
                    );
                    results[i] = check_rows(columns, raw, sizes[i], key_of);
                } catch (ex) {
                    if (!error) error = ex;
                }
            }
        };
        const workers = Math.min(AI_LIMITS.parallel_calls, sizes.length);
        await Promise.all(Array.from({ length: workers }, worker));
        return { rows: results.filter(Boolean).flat(), sent, error };
    }

    /** No usable rows at all: the first call's error, or a 502 of its own. */
    private no_rows(error: unknown): never {
        if (error) throw error;
        throw new BadGatewayException("The AI didn't make any usable rows. Try rewording it.");
    }

    /** This month's generated rows and the request limits, for the app's /ai/status. */
    async status(acct_id: number) {
        const account = await this.account(acct_id);
        return {
            rows: await this.rows_usage(account),
            limits: {
                max_rows_per_request: AI_LIMITS.max_rows_per_request,
                max_table_rows: AI_LIMITS.max_table_rows,
                max_prompt_length: AI_LIMITS.max_prompt_length
            }
        };
    }

    /**
     * Body: `{ prompt, count }`. Answers `{ rows, columns, usage }`: rows keyed by the table's
     * fields, values of the column types, not saved. The table must be the caller's.
     */
    async generate_rows(acct_id: number, file_id: unknown, body: any) {
        this.assert_enabled();
        const request = this.checked(() => parse_rows_request(body));
        const account = await this.verified_account(acct_id);
        await this.tracking_manager.check_account_lock(account);
        const file = await this.file_directory_svc.assert_owned(acct_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException('Table not found');
        await this.tracking_manager.check_table_lock(file.id);

        const columns = ai_columns(await this.web_file_manager.get_columns(acct_id, file.id));
        if (columns.length === 0) {
            throw new BadRequestException('Add a column (other than a link) first');
        }
        const samples = sample_rows(
            columns,
            await this.web_file_manager.first_rows(acct_id, file.id, AI_LIMITS.sample_rows)
        );

        // Every row asked of the model counts, even when its call failed or its rows were
        // unusable (the call costs the same); only rows never asked for are handed back.
        const month = await this.reserve(account, request.count);
        const spent: Spent[] = [];
        let sent = 0;
        let result: { rows: any[]; sent: number; error: unknown };
        try {
            result = await this.generate(columns, samples, request.prompt, request.count, spent);
            sent = result.sent;
        } finally {
            await this.ai_usage.release_rows(account.id, month, request.count - sent);
            await this.ai_spend.charge(account.id, month, spent);
        }
        const rows = result.rows;
        if (rows.length === 0) this.no_rows(result.error);
        return { rows, columns, usage: await this.rows_usage(account) };
    }

    /**
     * Body: `{ description, row_count }`. Answers a new table's design and sample rows, not
     * saved: `{ table_name, columns: [{ name, type }], rows (keyed by column name), usage }`.
     */
    async preview_table(acct_id: number, body: any) {
        this.assert_enabled();
        const request = this.checked(() => parse_table_request(body));
        const account = await this.verified_account(acct_id);
        await this.tracking_manager.check_account_lock(account);

        const cost = Math.max(1, request.row_count);
        const month = await this.reserve(account, cost);
        // The design counts as one row, and every row asked of the model counts; only rows
        // never asked for are handed back.
        const spent: Spent[] = [];
        let used = 0;
        let preview;
        try {
            used = 1;
            const raw = await this.call(
                {
                    system: TABLE_SYSTEM,
                    prompt: table_prompt(request.description),
                    schema: table_schema(),
                    max_tokens: 2048
                },
                spent
            );
            const design = this.checked(() => check_table_design(raw));
            let rows = [];
            if (request.row_count > 0) {
                const result = await this.generate(
                    design_columns(design.columns),
                    [],
                    request.description,
                    request.row_count,
                    spent,
                    c => c.name
                );
                used = Math.max(1, result.sent);
                rows = result.rows;
                if (rows.length === 0) this.no_rows(result.error);
            }
            preview = { ...design, rows };
        } finally {
            await this.ai_usage.release_rows(account.id, month, cost - used);
            await this.ai_spend.charge(account.id, month, spent);
        }
        return { ...preview, usage: await this.rows_usage(account) };
    }

    /**
     * Body: `{ table_name, columns: [{ name, type }], rows, parent_id? }`, a preview the user
     * may have edited. It's checked like a table template and made like one (the table and row
     * limits, the name rules, the folder's owner). Answers the new table's id.
     */
    async create_table(acct_id: number, body: any) {
        this.assert_enabled();
        await this.verified_account(acct_id);
        const b = body && typeof body === 'object' ? body : {};
        let template;
        try {
            template = validate_template('ai', {
                name: 'AI table',
                description: '',
                table_name: b.table_name,
                columns: b.columns,
                rows: b.rows === undefined ? [] : b.rows
            });
        } catch (ex) {
            // "Template "ai": ..." → the problem alone
            throw new BadRequestException(String(ex.message).replace(/^Template "ai": /, ''));
        }
        if (template.columns.length > AI_LIMITS.max_table_columns) {
            throw new BadRequestException(
                `A table can have at most ${AI_LIMITS.max_table_columns} columns here`
            );
        }
        return await this.table_template_svc.create_from(acct_id, template, {
            name: template.table_name,
            parent_id: b.parent_id
        });
    }
}
