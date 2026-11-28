import {
    Controller,
    Get,
    Post,
    Param,
    Request,
    Res,
    StreamableFile,
    UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { createReadStream } from 'fs';
import { AccountExportService } from '@app/application/account-export/account-export.service';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { NoDemoGuard } from '@app/web/http/_auth/demo.guard';

// Data export of the signed-in account (#215): ask for a zip of every table and the views and
// webhooks settings, see how it's going, and download it. Session only: an API key can't.
// Off in the demo (#333).
@Controller('account-export')
@UseGuards(AuthGuard('bearer'), NoDemoGuard)
export class AccountExportController {
    constructor(private export_service: AccountExportService) {}

    /** `{ export }`: the newest export (`null` when there's none). */
    @Get()
    async status(@Request() req) {
        return await this.export_service.status(session_account_id(req.user));
    }

    /** Queues a new export. 409 while one is being prepared, 429 past the daily limit. */
    @Post()
    async request(@Request() req) {
        return await this.export_service.request(session_account_id(req.user));
    }

    /** The zip, for 24 hours after it's ready. 404 for another account's, 410 once expired. */
    @Get(':id/download')
    async download(@Param('id') id: string, @Request() req, @Res({ passthrough: true }) res) {
        const file = await this.export_service.download(session_account_id(req.user), id);
        res.set({ 'Cache-Control': 'no-store' });
        return new StreamableFile(createReadStream(file.file_path), {
            type: 'application/zip',
            disposition: `attachment; filename="${file.name}"`
        });
    }
}
