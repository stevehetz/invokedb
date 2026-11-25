import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { WebFileService } from '../web-file/web-file.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { parse_count_query, parse_row_query } from '@app/core/web-file/row-query';
import { AiClient } from '@app/core/ai/ai-client';
import { AiSpend } from '@app/core/ai/ai-spend';
import { AI_OFF_MESSAGE, AI_UNVERIFIED_MESSAGE, ai_allowance } from '@app/core/ai/ai-plan';
import { AskError, ask_columns } from '@app/core/ai/ask';
import {
    CLEANUP_MAX_ROWS,
    CLEANUP_SYSTEM,
    CleanupProblem,
    ai_problems,
    ai_prompt,
    ai_request,
    ai_schema,
    cleanup_answer,
    parse_delete_body,
    parse_restore_body,
    row_still_holds,
    scan_rules,
    sees_whole_rows
} from '@app/core/ai/cleanup';
import { AskService } from './ask.service';
import { EditService } from './edit.service';
import logger from '@app/logger';

// AI data cleanup (#206), in Ask AI: `scan` reads the first CLEANUP_MAX_ROWS rows, runs the
// checks in code (core/ai/cleanup.ts) and asks the model, once, only about what code can't
// judge (spellings, near-duplicates). It writes nothing and answers problems with fixes; the
// app applies edits through apply-edit (#204) and duplicates through `delete_rows`, and Undo
// is apply-edit backwards and `restore_rows`. A scan uses one question, like Ask.
@Injectable()
export class CleanupService {
    constructor(
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private web_file_svc: WebFileService,
        private ai_client: AiClient,
        private ai_spend: AiSpend,
        private ask_service: AskService,
        private edit_service: EditService
    ) {}

    private async account(acct_id: number) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        return account;
    }

    private async columns(acct_id: number, file_id: number) {
        const col_defs = await this.web_file_manager.get_columns(acct_id, file_id);
        const columns = ask_columns(col_defs);
        return { columns, whole_rows: sees_whole_rows(col_defs, columns) };
    }

    private checked<T>(fn: () => T): T {
        try {
            return fn();
        } catch (ex) {
            if (ex instanceof AskError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    /**
     * Scans the table. Answers `{ answer, problems, scanned, total, capped, ai, usage }`:
     * `problems` as in core/ai/cleanup.ts (each with an `edit` or a `delete` to review, or
     * neither when there's no safe fix), `ai` whether the model was asked ('checked'), not
     * needed ('none') or didn't answer ('failed').
     */
    async scan(acct_id: number, file_id: unknown) {
        const account = await this.account(acct_id);
        await this.tracking_manager.check_account_lock(account);
        const file = await this.ask_service.owned_table(acct_id, file_id);
        if (!this.ai_client.available()) throw new ServiceUnavailableException(AI_OFF_MESSAGE);
        if (!ai_allowance(account).verified) throw new ForbiddenException(AI_UNVERIFIED_MESSAGE);
        const { columns, whole_rows } = await this.columns(acct_id, file.id);
        if (columns.length === 0) throw new BadRequestException('This table has no columns yet');

        // Read before the question is reserved, so a failed read doesn't use one up
        const query = parse_row_query({ limit: CLEANUP_MAX_ROWS }, columns, CLEANUP_MAX_ROWS);
        const res = await this.web_file_manager.query_rows(acct_id, file.id, query);
        const rows = this.edit_service.rows_by_field(res.docs.slice(0, CLEANUP_MAX_ROWS), columns);
        const total = await this.web_file_manager.count_rows(
            acct_id,
            file.id,
            parse_count_query({}, columns)
        );

        const month = await this.ask_service.reserve_question(account);
        const scan = scan_rules(rows, columns, whole_rows);
        const problems: CleanupProblem[] = [...scan.problems];
        const request = ai_request(rows, columns, scan);
        let ai: 'checked' | 'none' | 'failed' = 'none';
        if (request) {
            const spent = [];
            try {
                const res = await this.ai_client.json({
                    system: CLEANUP_SYSTEM,
                    prompt: ai_prompt(file.name, request),
                    schema: ai_schema(),
                    max_tokens: 4096
                });
                spent.push({ model: res.model, usage: res.usage });
                problems.push(...ai_problems(res.data, request, rows, columns, scan));
                ai = 'checked';
            } catch (ex) {
                if (ex instanceof HttpException) throw ex;
                // The checks in code still answer; the model's part is left out
                if (ex && ex.usage) spent.push({ model: ex.model, usage: ex.usage });
                logger.error(`ai cleanup failed for acct ${acct_id}: ${ex && ex.message}`);
                ai = 'failed';
            } finally {
                await this.ai_spend.charge(acct_id, month, spent);
            }
        }
        return {
            answer: cleanup_answer(problems, rows.length, total, ai, whole_rows),
            problems,
            scanned: rows.length,
            total,
            capped: total > rows.length,
            ai,
            usage: await this.ask_service.usage(account)
        };
    }

    /**
     * Deletes duplicate rows the user ticked. Body: `{ rows: [{ _id, before }] }`; a row is
     * deleted only if it still holds `before`. Answers `{ deleted: [ids], skipped: [ids] }`.
     */
    async delete_rows(acct_id: number, file_id: unknown, body: unknown) {
        const account = await this.account(acct_id);
        const file = await this.ask_service.owned_table(acct_id, file_id);
        const { columns, whole_rows } = await this.columns(acct_id, file.id);
        // The staleness check (and Undo) only cover these columns, so cells they can't see
        // would be lost: refused, as the scan offers no duplicates on such a table
        if (!whole_rows) {
            throw new BadRequestException(
                "Rows of a table with link columns (or two columns with the same name) can't be " +
                    'deleted as duplicates'
            );
        }
        const rows = this.checked(() => parse_delete_body(body, columns));
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.check_table_lock(file.id);
        const docs = await this.web_file_manager.rows_by_ids(
            acct_id,
            file.id,
            rows.map(r => r._id)
        );
        const deleted: string[] = [];
        const skipped: string[] = [];
        rows.forEach(r => {
            const doc = docs.get(r._id);
            const current = doc ? this.edit_service.rows_by_field([doc], columns)[0] : null;
            if (current && row_still_holds(current, r.before)) deleted.push(r._id);
            else skipped.push(r._id);
        });
        if (deleted.length > 0) {
            await this.web_file_svc.batch_delete(account, file.id, 'data_grid_row', deleted);
        }
        return { deleted, skipped };
    }

    /**
     * Puts deleted rows back (Undo), as new rows with the same cells. Body: `{ rows: [cells
     * keyed by field] }`. Answers `{ restored: n }`. The row limit and locks apply.
     */
    async restore_rows(acct_id: number, file_id: unknown, body: unknown) {
        const account = await this.account(acct_id);
        const file = await this.ask_service.owned_table(acct_id, file_id);
        const { columns } = await this.columns(acct_id, file.id);
        const rows = this.checked(() => parse_restore_body(body, columns));
        await this.web_file_svc.batch_create_internal(account, file.id, 'data_grid_row', rows);
        return { restored: rows.length };
    }
}
