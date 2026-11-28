import { Controller, Get, Post, Put, Request, Body, Param, UseGuards } from '@nestjs/common';

import { FileDirectoryService } from '@app/application/file-directory/file-directory.service';
import { FileDirectoryGetDto } from '@app/application/file-directory/dto/file-directory-get.dto';
import { FileDirectoryCreateDto } from '@app/application/file-directory/dto/file-directory-create.dto';
import { FileDirectoryUpdateDto } from '@app/application/file-directory/dto/file-directory-update.dto';
import { AuthGuard } from '@nestjs/passport';
import { AccountService } from '@app/application/account/account.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// Every route acts on the caller's own account. The frontend still sends `account_id` (in the
// query or body); it is accepted but ignored.
@Controller('file-directory')
@UseGuards(AuthGuard('bearer'))
export class FileDirectoryController {
    constructor(
        private file_directory_service: FileDirectoryService,
        private account_service: AccountService
    ) {}

    @Get()
    async file_directory_get(@Request() req) {
        const account_id = session_account_id(req.user);
        return (await this.file_directory_service.get_all(account_id)) as FileDirectoryGetDto[];
    }

    // Schema diagram (#208): every table with its columns and the links between them, laid out;
    // `?folder=<id>|unfiled&linked_only=true` narrows it (#376)
    @Get('schema')
    async file_directory_schema(@Request() req) {
        const account_id = session_account_id(req.user);
        return await this.file_directory_service.schema_diagram(account_id, {
            folder: req.query.folder,
            linked_only: req.query.linked_only
        });
    }

    @Post()
    async file_directory_post(@Body() create_dto: FileDirectoryCreateDto, @Request() req) {
        const account_id = session_account_id(req.user);
        const no_file = req.query.no_file === 'true';
        const res = await this.file_directory_service.create(account_id, create_dto, no_file);
        return res.id;
    }

    @Post('validate')
    async file_directory_validate(@Body() create_dto: FileDirectoryCreateDto, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.file_directory_service.validate({ ...create_dto, account_id });
    }

    @Put(':file_directory_id')
    async file_directory_put(
        @Param('file_directory_id') id,
        @Body() update_dto: FileDirectoryUpdateDto,
        @Request() req
    ) {
        const account_id = session_account_id(req.user);
        return await this.file_directory_service.update_owned(account_id, id, update_dto);
    }

    @Post('batch_delete')
    async file_directory_delete(@Request() req) {
        const account = await this.account_service.get(session_account_id(req.user));
        return await this.file_directory_service.batch_delete(account, req.body);
    }
}
