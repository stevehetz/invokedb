import {
    Controller,
    Post,
    Put,
    Request,
    UseInterceptors,
    UploadedFile,
    Body,
    UseGuards,
    Get,
    HttpException,
    HttpStatus,
    Response
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { WebFileService } from '@app/application/web-file/web-file.service';
import { FileDirectoryService } from '@app/application/file-directory/file-directory.service';
import { AuthGuard } from '@nestjs/passport';
import { AccountService } from '@app/application/account/account.service';
import { validate_file_dir_name, validate_file_dir_msg } from '@app/core/helpers/validators';
import env from '@app/env';
import logger from '@app/logger';
import _c from '@app/constants';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { public_api_base_url } from '@app/web/http/public-api-url';

@Controller('web-file')
@UseGuards(AuthGuard('bearer'))
export class WebFileController {
    constructor(
        private readonly web_file_service: WebFileService,
        private readonly file_dir_service: FileDirectoryService,
        private readonly account_service: AccountService
    ) {}

    @Get(':file_directory_id/get_new_column')
    async web_file_new_col(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const file_id = req.params.file_directory_id;
        const res = await this.web_file_service.get_new_column(acct_id, file_id);
        return res;
    }

    // Per-table API docs (#139): endpoints, examples and snippets built from the table's columns
    @Get(':file_directory_id/api-docs')
    async web_file_api_docs(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        return await this.web_file_service.table_api_docs(
            acct_id,
            req.params.file_directory_id,
            public_api_base_url(req)
        );
    }

    @Get(':file_directory_id/openapi.json')
    async web_file_openapi(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        return await this.web_file_service.table_openapi(
            acct_id,
            req.params.file_directory_id,
            public_api_base_url(req)
        );
    }

    // Link columns (#147): the account's tables (and their columns) a column can link to
    @Get(':file_directory_id/link-targets')
    async web_file_link_targets(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        return await this.web_file_service.link_targets(acct_id);
    }

    // Rows of a link column's table for the grid's picker: ?field=<column field>&q=<text>
    @Get(':file_directory_id/link-options')
    async web_file_link_options(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const account = await this.account_service.get(acct_id);
        return await this.web_file_service.link_options(
            account,
            req.params.file_directory_id,
            req.query.field,
            req.query.q
        );
    }

    @Post('batch_create/:web_file_type/:file_directory_id')
    async web_file_batch_create(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const account = await this.account_service.get(acct_id);
        const file_id = req.params.file_directory_id;
        const type = req.params.web_file_type;
        const res = await this.web_file_service.batch_create_internal(
            account,
            file_id,
            type,
            req.body
        );
        return res;
    }

    @Post('batch_delete/:web_file_type/:file_directory_id')
    async web_file_batch_delete(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const account = await this.account_service.get(acct_id);
        const file_id = req.params.file_directory_id;
        const type = req.params.web_file_type;
        const res = await this.web_file_service.batch_delete(account, file_id, type, req.body);
        return res;
    }

    @Post('/:web_file_type/:file_directory_id')
    async web_file_get(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const account = await this.account_service.get(acct_id);
        const file_id = req.params.file_directory_id;
        const type = req.params.web_file_type;
        const params = req.query;
        params.filters = req.body;
        const res = await this.web_file_service.get_all(account, file_id, type, params);
        return res;
    }

    @Put('batch_update/:web_file_type/:file_directory_id')
    async web_file_batch_update(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const account = await this.account_service.get(acct_id);
        const file_id = req.params.file_directory_id;
        const type = req.params.web_file_type;
        const res = await this.web_file_service.batch_update_internal(
            account,
            file_id,
            type,
            req.body
        );
        return res;
    }

    @Put('batch_update_job/:web_file_type/:file_directory_id')
    async web_file_batch_update_job(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const account = await this.account_service.get(acct_id);
        const file_id = req.params.file_directory_id;
        const type = req.params.web_file_type;
        const res = await this.web_file_service.batch_update_internal(
            account,
            file_id,
            type,
            req.body,
            true
        );
        return res;
    }

    @Put(':record_id/:web_file_type/:file_directory_id')
    async web_file_update(@Request() req) {
        const acct_id = session_account_id(req.user);
        await this.web_file_service.validate(acct_id, req.params.file_directory_id);
        const account = await this.account_service.get(acct_id);
        const file_id = req.params.file_directory_id;
        const type = req.params.web_file_type;
        const res = await this.web_file_service.update(account, file_id, type, req.body);
        return res;
    }

    @Post('file_upload')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: `${env.HORIZON_FILE_SHARE}/temp`,
                filename: (req, file, cb) => {
                    const date = new Date();
                    cb(null, `acct-${(req as any).user.account_id}_${date.getTime()}.csv`);
                }
            })
        })
    )
    async web_file_file_upload(@UploadedFile() file, @Body() body, @Request() req) {
        if (env.IS_HORIZON_FS !== 'true') {
            throw new HttpException(
                'Files can only be uploaded to horizon-fs',
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
        const acct_id = session_account_id(req.user);
        const account = await this.account_service.get(acct_id);

        // Create new record in postgres
        if (!validate_file_dir_name(body.new_name)) {
            throw new HttpException(validate_file_dir_msg(), HttpStatus.BAD_REQUEST);
        }

        const no_file = true;
        const file_res = await this.file_dir_service.create(
            acct_id,
            {
                account_id: acct_id,
                // multipart form fields arrive as strings
                parent_id: body.parent_id ? Number(body.parent_id) : null,
                name: body.new_name,
                type: 'file',
                web_file_type: 'data-grid',
                status: 'PENDING'
            },
            no_file
        );

        const file_id = file_res.id;
        const form_data = Object.assign({}, body, {
            file_id,
            file_name: file.filename
        });

        this.web_file_service.file_upload(account, form_data);

        return file_res.id;
    }
}
