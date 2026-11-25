import { Body, Controller, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AskService } from '@app/application/ai/ask.service';
import { AiService } from '@app/application/ai/ai.service';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { public_api_base_url } from '@app/web/http/public-api-url';

// AI features for the signed-in app: "ask your data" (#149) and generated rows and tables
// (#148). Off (available: false, 503) unless the server has an ANTHROPIC_API_KEY and a monthly
// AI budget; 429 when the account's monthly allowance is used up (docs/PRICING.md 3.5).
@Controller('ai')
@UseGuards(AuthGuard('bearer'))
export class AiController {
    constructor(
        private ask_service: AskService,
        private ai_service: AiService
    ) {}

    /**
     * `{ available, usage: { month, used, limit, tier, verified, budget_used }, rows: { month,
     * used, limit }, limits }`: `usage` counts questions, `rows` generated rows.
     */
    @Get('status')
    async status(@Request() req) {
        const account_id = session_account_id(req.user);
        return {
            ...(await this.ask_service.status(account_id)),
            ...(await this.ai_service.status(account_id))
        };
    }

    /**
     * Ask a question about a table. Body: `{ table: <table id>, question }`. Returns
     * `{ answer, rows, columns, total, api_call: { method, url, body, curl } | null, usage }`.
     */
    @Post('ask')
    async ask(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ask_service.ask(account_id, body, public_api_base_url(req));
    }

    /** Body: `{ prompt, count }`. Answers `{ rows, columns, usage }`; nothing is saved. */
    @Post('web-file/:file_directory_id/generate-rows')
    async generate_rows(@Param('file_directory_id') file_id: string, @Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ai_service.generate_rows(account_id, file_id, body);
    }

    /** Body: `{ description, row_count }`. Answers `{ table_name, columns, rows, usage }`. */
    @Post('table/preview')
    async preview_table(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ai_service.preview_table(account_id, body);
    }

    /** Body: a preview, `{ table_name, columns, rows, parent_id? }`. Answers the table's id. */
    @Post('table')
    async create_table(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ai_service.create_table(account_id, body);
    }
}
