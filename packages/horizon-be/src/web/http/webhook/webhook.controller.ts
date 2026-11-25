import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Query,
    Request,
    UseGuards,
    HttpCode,
    HttpStatus
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WebhookService } from '@app/application/webhook/webhook.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// Webhooks on row changes (#140), for the signed-in app
@Controller('webhook')
@UseGuards(AuthGuard('bearer'))
export class WebhookController {
    constructor(private webhook_service: WebhookService) {}

    /** `{ webhooks, events }`; `?table=<id>`: only those that fire for that table. */
    @Get()
    async list(@Query('table') table: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.webhook_service.list(account_id, table);
    }

    /** Body: `{ url, events, file_id? (null: every table), enabled? }`. */
    @Post()
    async create(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.webhook_service.create(account_id, body);
    }

    /** Body: any of `{ url, events, enabled, rotate_secret }`. */
    @Put(':id')
    async update(@Param('id') id: string, @Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.webhook_service.update(account_id, id, body);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.webhook_service.remove(account_id, id);
    }

    /** Queues a "ping" delivery; answers it (see /deliveries for how it went). */
    @Post(':id/test')
    @HttpCode(HttpStatus.OK)
    async test(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.webhook_service.test(account_id, id);
    }

    /** `{ deliveries }`: the newest first, each with its attempts. */
    @Get(':id/deliveries')
    async deliveries(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.webhook_service.deliveries(account_id, id);
    }
}
