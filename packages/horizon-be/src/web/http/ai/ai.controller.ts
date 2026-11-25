import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AskService } from '@app/application/ai/ask.service';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { public_api_base_url } from '@app/web/http/public-api-url';

// AI features for the signed-in app (#149). Off (available: false, 503) unless the server has
// an ANTHROPIC_API_KEY.
@Controller('ai')
@UseGuards(AuthGuard('bearer'))
export class AiController {
    constructor(private ask_service: AskService) {}

    /** `{ available, usage: { month, used, limit, tier } }` */
    @Get('status')
    async status(@Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ask_service.status(account_id);
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
}
