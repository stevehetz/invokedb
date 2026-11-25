import {
    Controller,
    Get,
    Request,
    Post,
    HttpStatus,
    HttpException,
    HttpCode,
    Put,
    UseGuards
} from '@nestjs/common';
import { WebFileService } from '@app/application/web-file/web-file.service';
import { AccountService } from '@app/application/account/account.service';
import { FileDirectoryService } from '@app/application/file-directory/file-directory.service';
import { AuthGuard } from '@nestjs/passport';
import { api_key_account } from '@app/web/http/_auth/request-account';
import { public_api_base_url } from '@app/web/http/public-api-url';

@Controller('api/v1')
@UseGuards(AuthGuard('bearer'))
export class ExternalV1Controller {
    constructor(
        private readonly web_file_service: WebFileService,
        private readonly account_service: AccountService,
        private readonly file_dir_service: FileDirectoryService
    ) {}

    async get_file_id(user, file_name) {
        const account = api_key_account(user);
        if (typeof file_name !== 'string' || file_name.length === 0) {
            throw new HttpException(
                `The 'table' query parameter is required`,
                HttpStatus.BAD_REQUEST
            );
        }
        const file_directories = await this.file_dir_service.get_by_account_id(account.id);
        let file_directory;
        if (file_directories && file_directories.length > 0) {
            file_directory = file_directories.find(
                f => f.name.toLowerCase() === file_name.toLowerCase()
            );
        }

        if (!file_directory) {
            throw new HttpException('File name not found', HttpStatus.BAD_REQUEST);
        }

        return file_directory.id;
    }

    @Get('get')
    async grid_as_json(@Request() req) {
        const file_id = await this.get_file_id(req.user, req.query.table);

        const params = Object.assign({}, req.query);
        const format = req.query.format;

        return await this.web_file_service.external_get_rows(req.user, file_id, params, format);
    }

    @Post('search')
    async grid_as_json_search(@Request() req) {
        const file_id = await this.get_file_id(req.user, req.query.table);
        const params = Object.assign({}, req.query);
        const format = req.query.format;
        params.filters = req.body;

        return await this.web_file_service.external_get_rows(req.user, file_id, params, format);
    }

    // Filters, sort, field selection and cursor paging in a JSON body (#141)
    @Post('query')
    @HttpCode(HttpStatus.OK)
    async query_rows(@Request() req) {
        const file_id = await this.get_file_id(req.user, req.query.table);
        return await this.web_file_service.external_query_rows(
            req.user,
            file_id,
            req.body,
            req.query.format
        );
    }

    // The number of rows matching the same filters as /query (#141)
    @Post('count')
    @HttpCode(HttpStatus.OK)
    async count_rows(@Request() req) {
        const file_id = await this.get_file_id(req.user, req.query.table);
        return await this.web_file_service.external_count_rows(
            req.user,
            file_id,
            req.body,
            req.query.format
        );
    }

    @Post('create')
    async grid_as_json_create_rows(@Request() req) {
        const file_id = await this.get_file_id(req.user, req.query.table);
        const format = req.query.format;

        return await this.web_file_service.external_create_rows(
            req.user,
            file_id,
            req.body,
            format
        );
    }

    @Put('update')
    async grid_as_json_update(@Request() req) {
        const file_id = await this.get_file_id(req.user, req.query.table);
        const format = req.query.format;

        return await this.web_file_service.external_update_rows(
            req.user,
            file_id,
            req.body,
            format
        );
    }

    // An OpenAPI 3 spec for one table (#139)
    @Get('openapi')
    async table_openapi(@Request() req) {
        const account = api_key_account(req.user);
        const file_id = await this.get_file_id(req.user, req.query.table);
        return await this.web_file_service.table_openapi(
            account.id,
            file_id,
            public_api_base_url(req)
        );
    }

    @Post('delete')
    async grid_as_json_delete(@Request() req) {
        const file_id = await this.get_file_id(req.user, req.query.table);

        return await this.web_file_service.external_delete_rows(req.user, file_id, req.body);
    }
}
