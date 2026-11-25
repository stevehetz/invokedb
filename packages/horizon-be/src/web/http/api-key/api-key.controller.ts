import { Controller, Get, Post, Delete, Param, Body, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiKeyService } from '@app/application/api-key/api-key.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// The account's API keys (#138), for the signed-in app only: a key can't make or see keys.
@Controller('api-key')
@UseGuards(AuthGuard('bearer'))
export class ApiKeyController {
    constructor(private readonly api_key_service: ApiKeyService) {}

    /** `{ keys, max }`; never the keys themselves, only their first characters (`prefix`). */
    @Get()
    async list(@Request() req) {
        return await this.api_key_service.list(session_account_id(req.user));
    }

    /** `{ requests, max }`: the key's last requests, newest first (#216). */
    @Get(':id/requests')
    async requests(@Param('id') id: string, @Request() req) {
        return await this.api_key_service.requests(session_account_id(req.user), id);
    }

    /**
     * Body: `{ name, access: 'read' | 'read_write', table_ids?, rate_limit_per_second?,
     * rate_limit_burst? }`. Answers `{ key, secret }`.
     */
    @Post()
    async create(@Body() body, @Request() req) {
        return await this.api_key_service.create(session_account_id(req.user), body);
    }

    /** Revokes the key: it stops working at once and can't be turned back on. */
    @Delete(':id')
    async revoke(@Param('id') id: string, @Request() req) {
        return await this.api_key_service.revoke(session_account_id(req.user), id);
    }
}
