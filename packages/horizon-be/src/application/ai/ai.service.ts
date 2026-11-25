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
import { AiUsageManager } from '@app/core/ai/ai-usage.manager';
import { AiModel, AiModelError, ai_model_from_env } from '@app/core/ai/ai-model';
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
    monthly_allowance,
    parse_rows_request,
    parse_table_request,
    rows_prompt,
    rows_schema,
    sample_rows,
    table_prompt,
    table_schema,
    usage_month
} from '@app/core/ai/ai';
import { validate_template } from '@app/core/table-template/table-template';
import logger from '@app/logger';

export const AI_OFF = "AI features aren't set up on this server.";

// AI-generated rows and tables (#148). Nothing here writes rows: "Generate rows" answers a
// preview that the app inserts through the ordinary row route (row limit, locks, webhooks), and
// "New table from a description" answers a design that `create_table` makes like a template.
// Every generated row counts against the account's monthly allowance, by plan tier.
@Injectable()
export class AiService {
    /** Null when ANTHROPIC_API_KEY isn't set. Replaced in the unit tests. */
    model: AiModel | null = ai_model_from_env();

    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private table_template_svc: TableTemplateService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private usage_manager: AiUsageManager
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
        if (!this.model) throw new ServiceUnavailableException(AI_OFF);
        return this.model;
    }

    private async account(acct_id: number) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        return account;
    }

    private async usage(account) {
        const month = usage_month(this.now());
        const allowance = monthly_allowance(account.subscription_id);
        const used = await this.usage_manager.used(account.id, month);
        return { month, used, allowance };
    }

    /** Takes `rows` of this month's allowance, or answers 429 saying what's left. */
    private async reserve(account, rows: number) {
        const month = usage_month(this.now());
        const allowance = monthly_allowance(account.subscription_id);
        if (await this.usage_manager.reserve(account.id, month, rows, allowance)) return month;
        const used = await this.usage_manager.used(account.id, month);
        const left = Math.max(0, allowance - used);
        throw new HttpException(
            left === 0
                ? `This month's AI allowance (${allowance} rows) is used up. It renews on the 1st.`
                : `Only ${left} of this month's ${allowance} AI rows are left. Ask for fewer.`,
            HttpStatus.TOO_MANY_REQUESTS
        );
    }

    private async call(request: Parameters<AiModel['json']>[0]) {
        const model = this.assert_enabled();
        try {
            return await model.json(request);
        } catch (ex) {
            logger.error(`AI call failed: ${ex && ex.message}`);
            if (ex instanceof AiModelError) throw new BadGatewayException(ex.message);
            throw new BadGatewayException("The AI didn't answer. Try again in a minute.");
        }
    }

    /** `count` rows for `columns`, in parallel model calls of at most rows_per_call rows. */
    private async generate(
        columns: AiColumn[],
        samples: any[],
        prompt: string,
        count: number,
        key_of?: (c: AiColumn) => string
    ) {
        const schema = rows_schema(columns);
        const sizes = batch_sizes(count);
        const results: any[][] = new Array(sizes.length);
        let next = 0;
        const worker = async () => {
            while (next < sizes.length) {
                const i = next++;
                const raw = await this.call({
                    system: ROWS_SYSTEM,
                    prompt: rows_prompt(columns, samples, prompt, sizes[i], {
                        index: i,
                        of: sizes.length
                    }),
                    schema,
                    max_tokens: max_tokens_for(sizes[i], columns.length),
                    rows: sizes[i]
                });
                results[i] = check_rows(columns, raw, sizes[i], key_of);
            }
        };
        const workers = Math.min(AI_LIMITS.parallel_calls, sizes.length);
        await Promise.all(Array.from({ length: workers }, worker));
        return results.flat();
    }

    /** Whether the AI features are on, this month's usage and the limits, for the app. */
    async status(acct_id: number) {
        const account = await this.account(acct_id);
        return {
            enabled: !!this.model,
            // "stub" in the smoke tests, which only then try the AI in the UI
            model: this.model ? this.model.name : null,
            usage: await this.usage(account),
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
        const account = await this.account(acct_id);
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

        const month = await this.reserve(account, request.count);
        let rows = [];
        try {
            rows = await this.generate(columns, samples, request.prompt, request.count);
        } finally {
            await this.usage_manager.release(account.id, month, request.count - rows.length);
        }
        if (rows.length === 0) {
            throw new BadGatewayException("The AI didn't make any usable rows. Try rewording it.");
        }
        return { rows, columns, usage: await this.usage(account) };
    }

    /**
     * Body: `{ description, row_count }`. Answers a new table's design and sample rows, not
     * saved: `{ table_name, columns: [{ name, type }], rows (keyed by column name), usage }`.
     */
    async preview_table(acct_id: number, body: any) {
        this.assert_enabled();
        const request = this.checked(() => parse_table_request(body));
        const account = await this.account(acct_id);
        await this.tracking_manager.check_account_lock(account);

        const cost = Math.max(1, request.row_count);
        const month = await this.reserve(account, cost);
        // The design costs one row's worth even when its rows fail; nothing if it fails itself
        let used = 0;
        let preview;
        try {
            const raw = await this.call({
                system: TABLE_SYSTEM,
                prompt: table_prompt(request.description),
                schema: table_schema(),
                max_tokens: 2048
            });
            const design = this.checked(() => check_table_design(raw));
            used = 1;
            let rows = [];
            if (request.row_count > 0) {
                rows = await this.generate(
                    design_columns(design.columns),
                    [],
                    request.description,
                    request.row_count,
                    c => c.name
                );
            }
            used = Math.max(1, rows.length);
            preview = { ...design, rows };
        } finally {
            await this.usage_manager.release(account.id, month, cost - used);
        }
        return { ...preview, usage: await this.usage(account) };
    }

    /**
     * Body: `{ table_name, columns: [{ name, type }], rows, parent_id? }`, a preview the user
     * may have edited. It's checked like a table template and made like one (the table and row
     * limits, the name rules, the folder's owner). Answers the new table's id.
     */
    async create_table(acct_id: number, body: any) {
        this.assert_enabled();
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
