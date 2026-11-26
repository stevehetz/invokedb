import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { AdminService } from '@app/application/admin/admin.service';
import { AdminGuard } from './admin.guard';

// The admin area (#277), for admins only (AdminGuard: anyone else gets 404). Answers only what
// the pages show; never a customer's rows. Every action is recorded in the account's history.
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
    constructor(private readonly admin_service: AdminService) {}

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
