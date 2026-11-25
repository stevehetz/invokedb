import { Controller, Get, Post, Param, Body, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TableTemplateService } from '@app/application/table-template/table-template.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// Table templates (#142). The templates are the same for everyone; a table made from one belongs
// to the caller's account.
@Controller('table-template')
@UseGuards(AuthGuard('bearer'))
export class TableTemplateController {
    constructor(private table_template_service: TableTemplateService) {}

    @Get()
    list(@Request() req) {
        session_account_id(req.user);
        return this.table_template_service.list();
    }

    /** Body: `{ name?, parent_id? }`. Answers the new table's id. */
    @Post(':template_id')
    async create(@Param('template_id') template_id: string, @Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.table_template_service.create(account_id, template_id, body);
    }
}
