import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AdminService } from '@app/application/admin/admin.service';
import { ErrorTrackingService } from '@app/application/error-tracking/error-tracking.service';
import { StatusService } from '@app/application/status/status.service';
import { WebsocketClient } from '@app/web/ws/websocket-client';
import { AdminGuard } from './admin.guard';

// The admin area (#277), for admins only (AdminGuard: anyone else gets 404). Answers only what
// the pages show; never a customer's rows. Every action is recorded in the account's history.
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
    constructor(
        private readonly admin_service: AdminService,
        private readonly error_tracking: ErrorTrackingService,
        private readonly status_service: StatusService,
        private readonly ws_client: WebsocketClient
    ) {}

    /** The Errors page (#212): `?source=api|processor|frontend&page=&limit=`, last seen first. */
    @Get('errors')
    async errors(@Query() query) {
        return await this.error_tracking.list(query);
    }

    /** One error, with its latest stack. */
    @Get('errors/:id')
    async error(@Param('id') id: string) {
        return await this.error_tracking.get(id);
    }

    /** The public status page's answer, for the admin's Status tab. */
    @Get('status')
    async status() {
        return await this.status_service.status(this.ws_client.ready());
    }

    /** `{ message, level?: 'info' | 'degraded' | 'outage' }`: the note on the status page. */
    @Post('status/incident')
    async set_incident(@Body() body) {
        return await this.status_service.set_incident(body);
    }

    @Post('status/incident/clear')
    async clear_incident() {
        return await this.status_service.clear_incident();
    }

    /** Sign-ups, active accounts, plans, totals, AI spend against the budget, the E2E test. */
    @Get('overview')
    async overview() {
        return await this.admin_service.overview();
    }

    /** `?search=&sort=&dir=&page=&limit=&caps=all|over|near|flagged&plan=` */
    @Get('accounts')
    async accounts(@Query() query) {
        return await this.admin_service.accounts(query);
    }

    @Get('accounts/:id')
    async account(@Param('id') id: string) {
        return await this.admin_service.account(id);
    }

    /** `{ plan: 'FREE' | 'STARTER' | 'PRO' | 'INTERNAL' }` */
    @Post('accounts/:id/plan')
    async change_plan(@Param('id') id: string, @Body() body, @Request() req) {
        return await this.admin_service.change_plan(req.admin, id, body);
    }

    /** `{ reason? }` */
    @Post('accounts/:id/lock')
    async lock(@Param('id') id: string, @Body() body, @Request() req) {
        return await this.admin_service.lock(req.admin, id, body);
    }

    @Post('accounts/:id/unlock')
    async unlock(@Param('id') id: string, @Request() req) {
        return await this.admin_service.unlock(req.admin, id);
    }

    @Post('accounts/:id/resend-verification')
    async resend_verification(@Param('id') id: string, @Request() req) {
        return await this.admin_service.resend_verification(req.admin, id);
    }

    @Post('accounts/:id/reset-two-factor')
    async reset_two_factor(@Param('id') id: string, @Request() req) {
        return await this.admin_service.reset_two_factor(req.admin, id);
    }

    /** `{ confirm: '<the account's email>' }` */
    @Post('accounts/:id/delete')
    async delete_account(@Param('id') id: string, @Body() body, @Request() req) {
        return await this.admin_service.delete_account(req.admin, id, body);
    }
}
