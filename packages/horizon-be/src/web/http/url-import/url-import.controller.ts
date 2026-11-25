import { Controller, Get, Post, Put, Param, Body, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UrlImportService } from '@app/application/url-import/url-import.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// Tables imported from a Google Sheet or a CSV / JSON URL (#144), for the signed-in app
@Controller('url-import')
@UseGuards(AuthGuard('bearer'))
export class UrlImportController {
    constructor(private url_import_service: UrlImportService) {}

    /** Body: `{ new_name, url, parent_id?, mode?, key_column?, schedule? }`. Answers the table id. */
    @Post()
    async create(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.url_import_service.create(account_id, body);
    }

    /** `{ source }`: the table's source and its last sync, or null if it wasn't imported. */
    @Get(':file_id')
    async get(@Param('file_id') file_id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.url_import_service.get(account_id, file_id);
    }

    /** Body: any of `{ url, mode, key_column, schedule }`. */
    @Put(':file_id')
    async update(@Param('file_id') file_id: string, @Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.url_import_service.update(account_id, file_id, body);
    }

    /** Fetches the source again and updates the table. */
    @Post(':file_id/sync')
    async sync(@Param('file_id') file_id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.url_import_service.sync(account_id, file_id);
    }
}
