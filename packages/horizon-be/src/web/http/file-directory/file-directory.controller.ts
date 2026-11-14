import { Controller, Get, Post, Put, Request, Query, Body, Param, UseGuards } from '@nestjs/common';

import { FileDirectoryService } from '@app/application/file-directory/file-directory.service';
import { FileDirectoryGetDto } from '@app/application/file-directory/dto/file-directory-get.dto';
import { FileDirectoryCreateDto } from '@app/application/file-directory/dto/file-directory-create.dto';
import { FileDirectoryUpdateDto } from '@app/application/file-directory/dto/file-directory-update.dto';
import { AuthGuard } from '@nestjs/passport';
import { AccountService } from '@app/application/account/account.service';

@Controller('file-directory')
@UseGuards(AuthGuard('bearer'))
export class FileDirectoryController {
    constructor(
        private file_directory_service: FileDirectoryService,
        private account_service: AccountService
    ) {}

    @Get()
    async file_directory_get(@Query() query) {
        const id = query.account_id;
        return (await this.file_directory_service.get_all(id)) as FileDirectoryGetDto[];
    }

    @Post()
    async file_directory_post(
        @Param('no_file') no_file,
        @Body() create_dto: FileDirectoryCreateDto,
        @Request() req
    ) {
        no_file = no_file === 'true' ? true : false;
        const res = await this.file_directory_service.create(
            req.user.account_id,
            create_dto,
            no_file
        );
        return res.id;
    }

    @Post('validate')
    async file_directory_validate(@Body() create_dto: FileDirectoryCreateDto) {
        return await this.file_directory_service.validate(create_dto);
    }

    @Put(':file_directory_id')
    async file_directory_put(
        @Param('file_directory_id') id,
        @Body() update_dto: FileDirectoryUpdateDto
    ) {
        const res = await this.file_directory_service.update(id, update_dto);
        return res;
    }

    @Post('batch_delete')
    async file_directory_delete(@Request() req) {
        const account = await this.account_service.get(req.user.account_id);
        const res = await this.file_directory_service.batch_delete(account, req.body);
        return res;
    }
}
