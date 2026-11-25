import { Controller, Get, Post, Param, Body, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiService } from '@app/application/ai/ai.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// AI-generated rows and tables (#148), for the signed-in app. 503 on every route but `status`
// when ANTHROPIC_API_KEY isn't set; 429 when the month's allowance is used up.
@Controller('ai')
@UseGuards(AuthGuard('bearer'))
export class AiController {
    constructor(private ai_service: AiService) {}

    /** `{ enabled, model, usage: { month, used, allowance }, limits }` */
    @Get('status')
    async status(@Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ai_service.status(account_id);
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
