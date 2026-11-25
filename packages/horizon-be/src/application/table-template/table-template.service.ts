import { Injectable, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { WebFileService } from '../web-file/web-file.service';
import { AccountService } from '../account/account.service';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { validate_file_dir_name, validate_file_dir_msg } from '@app/core/helpers/validators';
import {
    TableTemplate,
    load_templates,
    template_column_docs,
    template_row_data
} from '@app/core/table-template/table-template';
import _c from '@app/constants';
import logger from '@app/logger';

@Injectable()
export class TableTemplateService {
    private templates: TableTemplate[] = null;

    constructor(
        private file_directory_svc: FileDirectoryService,
        private web_file_svc: WebFileService,
        private account_svc: AccountService,
        private web_file_manager: WebFileManager,
        private tracking_manager: TrackingManager
    ) {}

    /** The templates, read from disk once. Replaced in tests. */
    get_templates(): TableTemplate[] {
        if (!this.templates) this.templates = load_templates();
        return this.templates;
    }

    /** What the "New table" dialog shows: each template's columns, without the sample rows. */
    list() {
        return this.get_templates().map(t => ({
            id: t.id,
            name: t.name,
            description: t.description,
            table_name: t.table_name,
            columns: t.columns,
            row_count: t.rows.length
        }));
    }

    /**
     * Creates a table in the caller's account from a template: its columns (with their types)
     * and sample rows. It is made like any other table, so the account's table and row limits,
     * the name rules and the parent folder's ownership are all checked; if the rows can't be
     * added, the new table is deleted again.
     */
    async create(acct_id: number, template_id: string, body: any) {
        const template = this.get_templates().find(t => t.id === template_id);
        if (!template) throw new NotFoundException('Template not found');
        return await this.create_from(acct_id, template, body);
    }

    /** Creates a table from a checked template: a template file's, or one the AI made (#148). */
    async create_from(acct_id: number, template: TableTemplate, body: any) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);

        const name = body && body.name !== undefined ? body.name : template.table_name;
        if (typeof name !== 'string' || !validate_file_dir_name(name)) {
            throw new HttpException(validate_file_dir_msg(), HttpStatus.BAD_REQUEST);
        }
        const parent_id =
            body && body.parent_id !== undefined && body.parent_id !== null
                ? Number(body.parent_id)
                : null;

        const no_file = true;
        const file = await this.file_directory_svc.create(
            acct_id,
            { name, parent_id, type: 'file', web_file_type: 'data-grid' },
            no_file
        );

        try {
            const columns = template_column_docs(template, file.id);
            await this.web_file_manager.batch_create(
                acct_id,
                file.id,
                _c.MongoDbCollections.data_grid_column,
                columns
            );
            const rows = template_row_data(template, columns);
            if (rows.length > 0) {
                await this.web_file_svc.batch_create_internal(
                    account,
                    file.id,
                    _c.MongoDbCollections.data_grid_row,
                    rows
                );
            }
        } catch (ex) {
            logger.error(`Template ${template.id} for file ${file.id} failed: ${ex.message}`);
            await this.file_directory_svc.batch_delete(account, { ids: [file.id] });
            throw ex;
        }

        return file.id;
    }
}
