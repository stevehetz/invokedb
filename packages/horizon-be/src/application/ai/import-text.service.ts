import {
    BadGatewayException,
    BadRequestException,
    ForbiddenException,
    HttpException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException
} from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { AiClient, AiModelError } from '@app/core/ai/ai-client';
import { AiUsageManager } from '@app/core/ai/ai-usage.manager';
import { AiSpend } from '@app/core/ai/ai-spend';
import { AI_OFF_MESSAGE, AI_UNVERIFIED_MESSAGE, ai_allowance } from '@app/core/ai/ai-plan';
import { ai_columns, rows_schema, max_tokens_for } from '@app/core/ai/ai';
import {
    IMPORT_LIMITS,
    IMPORT_SYSTEM,
    ImportError,
    import_answer,
    import_prompt,
    import_rows,
    parse_import_request
} from '@app/core/ai/import-text';
import { AiService } from './ai.service';
import { AskService } from './ask.service';
import logger from '@app/logger';

// Paste messy text into Ask AI (#207): one AiClient.json call turns the text into rows of the
// table's columns (core/ai/import-text.ts), answered like propose_rows (#234) for the app to put
// in the grid as new rows; nothing is saved here. A paste uses one question, and the rows it
// makes count against the month's AI rows: as many as are left are reserved (at most
// IMPORT_LIMITS.max_rows) and the ones the model didn't make are handed back.
@Injectable()
export class ImportTextService {
    constructor(
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private ai_client: AiClient,
        private ai_usage: AiUsageManager,
        private ai_spend: AiSpend,
        private ai_service: AiService,
        private ask_service: AskService
    ) {}

    /**
     * Body: `{ text }`. Answers `{ answer, proposed: { rows (keyed by field), columns }, capped,
     * usage, rows_usage }`, or `proposed: null` when the text held no rows.
     */
    async preview(acct_id: number, file_id: unknown, body: unknown) {
        let request: { text: string };
        try {
            request = parse_import_request(body);
        } catch (ex) {
            if (ex instanceof ImportError) throw new BadRequestException(ex.message);
            throw ex;
        }
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        // Rows a read-only account (#184) couldn't save aren't made (nor charged)
        await this.tracking_manager.check_not_read_only(account);
        const file = await this.ask_service.owned_table(acct_id, file_id);
        if (!this.ai_client.available()) throw new ServiceUnavailableException(AI_OFF_MESSAGE);
        if (!ai_allowance(account).verified) throw new ForbiddenException(AI_UNVERIFIED_MESSAGE);
        await this.tracking_manager.check_table_lock(file.id);
        const columns = ai_columns(await this.web_file_manager.get_columns(acct_id, file.id));
        if (columns.length === 0) {
            throw new BadRequestException('Add a column (other than a link) first');
        }

        // Rows first, so a month with no rows left doesn't use a question up
        const reserved = await this.ai_service.reserve_up_to(account, IMPORT_LIMITS.max_rows);
        const month = reserved.month;
        let used_rows = 0;
        try {
            await this.ask_service.reserve_question(account);
        } catch (ex) {
            await this.ai_service.release_rows(account, month, reserved.rows);
            throw ex;
        }

        const spent = [];
        let result: ReturnType<typeof import_rows>;
        try {
            const res = await this.ai_client.json({
                system: IMPORT_SYSTEM,
                prompt: import_prompt(columns, request.text, reserved.rows),
                schema: rows_schema(columns),
                max_tokens: max_tokens_for(reserved.rows, columns.length)
            });
            spent.push({ model: res.model, usage: res.usage });
            result = import_rows(columns, res.data, request.text, reserved.rows);
            used_rows = result.rows.length;
        } catch (ex) {
            logger.error(`ai import failed for acct ${acct_id}: ${ex && ex.message}`);
            if (ex instanceof HttpException) throw ex;
            if (ex instanceof AiModelError) {
                // The model answered (and was paid for), but not usably: the question counts
                if (ex.usage) spent.push({ model: ex.model, usage: ex.usage });
                throw new BadGatewayException(ex.message);
            }
            // Not the user's fault: the question isn't counted
            await this.ai_usage.release(acct_id, month);
            throw new BadGatewayException("The AI service didn't answer. Please try again.");
        } finally {
            await this.ai_service.release_rows(account, month, reserved.rows - used_rows);
            await this.ai_spend.charge(acct_id, month, spent);
        }

        const n = result.rows.length;
        return {
            answer: import_answer(
                n,
                result.capped,
                reserved.rows,
                reserved.rows < IMPORT_LIMITS.max_rows
            ),
            proposed: n > 0 ? { rows: result.rows, columns } : null,
            capped: result.capped,
            usage: await this.ask_service.usage(account),
            rows_usage: await this.ai_service.rows_usage(account)
        };
    }
}
