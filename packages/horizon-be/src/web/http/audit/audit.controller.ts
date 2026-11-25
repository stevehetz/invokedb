import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuditService } from '@app/application/audit/audit.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// The audit log (#217), for the signed-in app only: an API key can't read it
@Controller('audit')
@UseGuards(AuthGuard('bearer'))
export class AuditController {
    constructor(private audit_service: AuditService) {}

    /**
     * `{ entries, next_cursor, keep_days }`, newest first. `?table=<id>`: one table's entries;
     * `?limit=` (at most 100) and `?cursor=` (the last page's `next_cursor`) page through them.
     */
    @Get()
    async list(@Query() query, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.audit_service.list(account_id, query.table, query);
    }
}
