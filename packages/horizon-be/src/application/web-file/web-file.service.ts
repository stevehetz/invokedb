import {
    Injectable,
    NotFoundException,
    UnauthorizedException,
    HttpException,
    HttpStatus
} from '@nestjs/common';
import { snakeCase } from 'snake-case';
import camelCase from 'camelcase';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { JobManager } from '@app/core/job/job.manager';
import { WebFilePrcNotifyService } from './web-file-prc-notify.service';
import env from '@app/env';
import _c from '@app/constants';
import logger from '@app/logger';
import { assert_array_body } from '@app/core/helpers/array-body';
import { assert_column_update } from '@app/core/helpers/column-update';
import { build_openapi, build_table_docs, TableDocsInput } from '@app/core/table-docs/table-docs';
import {
    QueryColumn,
    encode_cursor,
    explain_indexes,
    max_query_limit,
    parse_count_query,
    parse_row_query
} from '@app/core/web-file/row-query';
import { WebhookService } from '../webhook/webhook.service';

const fs = require('fs');

@Injectable()
export class WebFileService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private web_file_prc_notify_svc: WebFilePrcNotifyService,
        private web_file_manager: WebFileManager,
        private tracking_manager: TrackingManager,
        private job_manager: JobManager,
        private webhook_svc: WebhookService
    ) {}

    async get_new_column(acct_id, file_id) {
        return await this.web_file_manager.get_new_column(acct_id, file_id);
    }

    async validate(account_id, file_directory_id) {
        const file_directory = await this.file_directory_svc.get_by_id(file_directory_id);

        if (!file_directory) {
            throw new NotFoundException();
        }

        if (file_directory.account_id !== account_id) {
            throw new UnauthorizedException();
        }
    }

    async get_all(account, file_id, web_file_type, page_params) {
        await this.tracking_manager.check_account_lock(account);
        if (page_params && page_params.filters) {
            const { filters } = page_params;
            Object.keys(filters).forEach(key => {
                filters[key].case = filters[key].case || 'insensitive';
            });
        }
        return await this.web_file_manager.get_all(account.id, file_id, web_file_type, page_params);
    }

    transform_filters(filters) {
        if (!filters) return;

        const types = ['$ctn', '$eq', '$gt', '$gte', '$lt', '$lte'];

        const transform = column_filter => {
            types.forEach(type => {
                if (typeof column_filter[type] !== 'undefined') {
                    switch (type) {
                        case '$ctn':
                            column_filter.type = 'contains';
                            column_filter.case = column_filter.case || 'insensitive';
                            break;
                        case '$eq':
                            column_filter.type = 'equals';
                            break;
                        case '$gt':
                            column_filter.type = 'greaterThan';
                            break;
                        case '$gte':
                            column_filter.type = 'greaterThanOrEqual';
                            break;
                        case '$lt':
                            column_filter.type = 'lessThan';
                            break;
                        case '$lte':
                            column_filter.type = 'lessThanOrEqual';
                            break;
                        default:
                            break;
                    }
                    column_filter.value = column_filter[type];
                    delete column_filter[type];
                }
            });

            if (column_filter.case) {
                if (column_filter.case === 'i') {
                    column_filter.case = 'insensitive';
                }
                if (column_filter.case === 's') {
                    column_filter.case = 'sensitive';
                }
            }
        };

        const convert = value => {
            if (typeof value === 'string' || typeof value === 'number') {
                const column_filter: any = {};
                column_filter.type = 'equals';
                column_filter.value = value;
                return column_filter;
            }
            return value;
        };

        const _filters = filters.$or || filters;
        const columns = Object.keys(_filters);
        columns.forEach(column => {
            if (column === '$group' || column === '$and' || column === '$or') return;
            if (Array.isArray(_filters[column])) {
                _filters[column].forEach(c => transform(c));
            } else {
                _filters[column] = convert(_filters[column]);
                transform(_filters[column]);
            }
        });
    }

    async external_get_rows(account, file_id, page_params, format) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.update_req_count(account);
        await this.tracking_manager.check_table_lock(file_id);

        const columns = await this.web_file_manager.get_all(
            account.id,
            file_id,
            'data_grid_column'
        );

        this.transform_filters(page_params.filters);

        this.validate_external_get_rows_filters(page_params.filters);

        if (page_params.filters) {
            page_params.filters = this.get_filters_from_columns(page_params.filters, columns.data);
        }

        if (page_params.sort_by && page_params.sort_dir) {
            columns.data.forEach(c => {
                if (c.headerName === page_params.sort_by) {
                    page_params.sort_by = c.field;
                }
            });
        }

        const rows = await this.web_file_manager.get_all(
            account.id,
            file_id,
            'data_grid_row',
            page_params
        );

        const response = {
            count: rows.count,
            data: rows.data.map(r => {
                const newRow: any = { _id: r._id };
                columns.data.forEach(c => {
                    const key = this.get_key_from_column_name(c.headerName, format);
                    newRow[key] = r[c.field];
                });
                return newRow;
            })
        };

        return response;
    }

    // The table's columns as /api/v1/query sees them (#141)
    private async query_columns(account, file_id, format): Promise<QueryColumn[]> {
        const columns = await this.web_file_manager.get_all(
            account.id,
            file_id,
            'data_grid_column'
        );
        return ((columns && columns.data) || [])
            .filter(c => typeof c.headerName === 'string' && c.headerName.length > 0)
            .map(c => ({
                name: this.get_key_from_column_name(c.headerName, format),
                header_name: c.headerName,
                field: c.field,
                type: c.col_type === 'number' || c.col_type === 'date' ? c.col_type : 'string'
            }));
    }

    private async check_external_request(account, file_id) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.update_req_count(account);
        await this.tracking_manager.check_table_lock(file_id);
    }

    // POST /api/v1/query (#141): filters, sort, fields and cursor paging
    async external_query_rows(account, file_id, body, format) {
        await this.check_external_request(account, file_id);
        const columns = await this.query_columns(account, file_id, format);
        const query = parse_row_query(body, columns, max_query_limit());
        const res = await this.web_file_manager.query_rows(account.id, file_id, query);
        if (query.explain) {
            return { explain: explain_indexes(res.explain, columns) };
        }
        const docs = res.docs.slice(0, query.limit);
        const has_more = res.docs.length > query.limit;
        const last = docs[docs.length - 1];
        return {
            data: docs.map(doc => {
                const row: any = { _id: doc._id };
                query.fields.forEach(c => {
                    const value = doc[c.field] === undefined ? null : doc[c.field];
                    row[c.name] =
                        c.type === 'date' && value
                            ? this.web_file_manager.format_date_field(value)
                            : value;
                });
                return row;
            }),
            next_cursor: has_more && last ? encode_cursor(last, query.sort, query.signature) : null
        };
    }

    // POST /api/v1/count (#141): how many rows match the filters
    async external_count_rows(account, file_id, body, format) {
        await this.check_external_request(account, file_id);
        const columns = await this.query_columns(account, file_id, format);
        const query = parse_count_query(body, columns);
        return { count: await this.web_file_manager.count_rows(account.id, file_id, query) };
    }

    validate_external_get_rows_filters(filters) {
        if (filters && Array.isArray(filters)) {
            throw new HttpException('Filters must be an object', HttpStatus.BAD_REQUEST);
        }
    }

    get_filters_from_columns(filters, columns) {
        const new_filters: any = {};
        if (filters._id) {
            new_filters._id = filters._id;
        }
        if (filters.$group) {
            columns.forEach(c => {
                if (c.headerName === filters.$group) {
                    filters.$group = c.field;
                }
            });
            new_filters.$group = filters.$group;
        }
        if (filters.$or) {
            new_filters.$or = {};
            Object.assign(new_filters.$or, this.create_new_filters(filters.$or, columns));
        }
        Object.assign(new_filters, this.create_new_filters(filters, columns));
        return new_filters;
    }

    async external_create_rows(account, file_id, body, format) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.update_req_count(account);
        await this.tracking_manager.check_table_lock(file_id);
        const columns = await this.web_file_manager.get_all(
            account.id,
            file_id,
            'data_grid_column'
        );
        const col_defs = columns.data;
        if (format) {
            col_defs.forEach(
                c => (c.headerName = this.get_key_from_column_name(c.headerName, format))
            );
        }

        this.validate_external_create_rows_body(body);
        this.validate_external_save_rows_body(body, col_defs);

        const col_field_map = {};
        col_defs.forEach(col_def => {
            col_field_map[col_def.headerName] = col_def.field;
        });

        const data = [];
        body.forEach(body_obj => {
            const data_obj: any = {};
            Object.keys(body_obj).forEach(body_field => {
                const col_field = col_field_map[body_field];
                data_obj[col_field] = body_obj[body_field];
            });
            data.push(data_obj);
        });

        await this.batch_create(account, file_id, 'data_grid_row', data);
    }

    async external_update_rows(account, file_id, body, format) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.update_req_count(account);
        await this.tracking_manager.check_table_lock(file_id);
        const columns = await this.web_file_manager.get_all(
            account.id,
            file_id,
            'data_grid_column'
        );
        const col_defs = columns.data;
        if (format) {
            col_defs.forEach(
                c => (c.headerName = this.get_key_from_column_name(c.headerName, format))
            );
        }

        this.validate_external_update_rows_body(body);
        this.validate_external_save_rows_body(body, col_defs);

        const col_field_map = {};
        col_defs.forEach(col_def => {
            col_field_map[col_def.headerName] = col_def.field;
        });

        const data = [];
        body.forEach(body_obj => {
            const data_obj: any = {};
            Object.keys(body_obj).forEach(body_field => {
                if (body_field === '_id') {
                    data_obj._id = body_obj[body_field];
                } else {
                    const col_field = col_field_map[body_field];
                    data_obj[col_field] = body_obj[body_field];
                }
            });
            data.push(data_obj);
        });

        return await this.batch_update(account, file_id, 'data_grid_row', data);
    }

    async external_delete_rows(account, file_id, body) {
        await this.tracking_manager.update_req_count(account);
        await this.tracking_manager.check_table_lock(file_id);
        this.validate_external_delete_rows_body(body);
        return await this.batch_delete(account, file_id, 'data_grid_row', body);
    }

    validate_external_create_rows_body(body) {
        body.forEach(body_obj => {
            if (body_obj._id) {
                throw new HttpException(
                    'Objects cannot contain an _id field',
                    HttpStatus.BAD_REQUEST
                );
            }
        });
    }

    validate_external_update_rows_body(body) {
        body.forEach(body_obj => {
            if (!body_obj._id) {
                throw new HttpException('Objects must conain an _id field', HttpStatus.BAD_REQUEST);
            }
        });
    }

    validate_external_delete_rows_body(body) {
        if (!body || !Array.isArray(body)) {
            throw new HttpException(
                'DELETE body must be an array of _id values',
                HttpStatus.BAD_REQUEST
            );
        }
        if (body.length === 0) {
            throw new HttpException('DELETE body is empty', HttpStatus.BAD_REQUEST);
        }
        body.forEach(value => {
            if (typeof value !== 'string') {
                throw new HttpException(
                    'DELETE body must be an array of string _id values',
                    HttpStatus.BAD_REQUEST
                );
            }
        });
    }

    validate_external_save_rows_body(body, col_defs) {
        if (!body || !Array.isArray(body)) {
            throw new HttpException('POST body must be an Array', HttpStatus.BAD_REQUEST);
        }

        if (body.length === 0) {
            throw new HttpException('POST body is empty', HttpStatus.BAD_REQUEST);
        }

        if (body.length > 100) {
            throw new HttpException(
                'POST body cannot have a length greater than 100',
                HttpStatus.BAD_REQUEST
            );
        }

        body.forEach(body_obj => {
            Object.keys(body_obj).forEach(body_field => {
                if (
                    body_field !== '_id' &&
                    !col_defs.find(col_def => col_def.headerName === body_field)
                ) {
                    throw new HttpException(
                        `${body_field} is not a valid column`,
                        HttpStatus.BAD_REQUEST
                    );
                }
            });
        });
    }

    create_new_filters(filters, columns) {
        const new_filters = {};

        columns
            .filter(c => Object.keys(filters).includes(c.headerName))
            .forEach(c => {
                new_filters[c.field] = filters[c.headerName];
                if (Array.isArray(new_filters[c.field])) {
                    new_filters[c.field].forEach(f => {
                        f.col_type = c.col_type || 'string';
                    });
                } else {
                    new_filters[c.field].col_type = c.col_type || 'string';
                }
            });
        return new_filters;
    }

    // What the per-table API docs (#139) are built from: the table's name, its columns and one
    // row for example values. The caller has checked that the table is the account's.
    private async table_docs_input(account_id, file_id, base_url): Promise<TableDocsInput> {
        const file = await this.file_directory_svc.get_by_id(Number(file_id));
        if (!file || file.type !== 'file' || file.deleted) throw new NotFoundException();
        const columns = await this.web_file_manager.get_all(
            account_id,
            file.id,
            'data_grid_column'
        );
        const col_defs = (columns && columns.data) || [];
        const rows = await this.web_file_manager.get_all(account_id, file.id, 'data_grid_row', {
            skip: '0',
            limit: '1'
        });
        const row = rows && rows.data && rows.data[0];
        let sample_row;
        if (row) {
            sample_row = { _id: String(row._id) };
            col_defs.forEach(c => (sample_row[c.headerName] = row[c.field]));
        }
        return {
            table: file.name,
            base_url,
            columns: col_defs.map(c => ({ name: c.headerName, type: c.col_type })),
            sample_row
        };
    }

    async table_api_docs(account_id, file_id, base_url) {
        return build_table_docs(await this.table_docs_input(account_id, file_id, base_url));
    }

    async table_openapi(account_id, file_id, base_url) {
        return build_openapi(await this.table_docs_input(account_id, file_id, base_url));
    }

    get_key_from_column_name(columnName, format) {
        if (format === 'camelCase') {
            return camelCase(columnName);
        } else if (format === 'snakeCase') {
            return snakeCase(columnName);
        } else {
            return columnName;
        }
    }

    async update(account, file_id, web_file_type, data) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.check_table_lock(file_id);
        if (web_file_type === 'data_grid_column') {
            data = assert_column_update(data);
        }
        const res = await this.web_file_manager.update(account.id, file_id, web_file_type, data);
        if (web_file_type === 'data_grid_row' && res) {
            await this.webhook_svc.emit(account.id, file_id, 'row.updated', [res]);
        }
        return res;
    }

    async batch_update_internal(account, file_id, web_file_type, data, use_job = false) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.check_table_lock(file_id);
        const res = await this.batch_update(account, file_id, web_file_type, data, use_job);
        return res;
    }

    private async batch_update(account, file_id, web_file_type, data, use_job = false) {
        data = assert_array_body(data);
        await this.tracking_manager.check_account_lock(account);
        if (web_file_type === 'data_grid_column') {
            // Check every column before tracking or queueing anything, so a bad one is a 400.
            data.forEach(col => assert_column_update(col));
            const cols_to_be_added = data.length;
            await this.tracking_manager.add_columns(account, { cols_to_be_added, file_id });
            try {
                if (!use_job) {
                    return await this.web_file_manager.batch_update_column(
                        account.id,
                        file_id,
                        'data_grid_column',
                        data
                    );
                } else {
                    await this.file_directory_svc.update(file_id, {
                        status: 'PENDING'
                    });
                    await this.job_manager.create({
                        account_id: account.id,
                        file_id,
                        status: 'PENDING',
                        event: 'COLUMN_UPDATE',
                        data: JSON.stringify(data)
                    });
                    this.web_file_prc_notify_svc.job_start(
                        _c.HORIZON_BE_WS_CLIENT_ID,
                        account.id,
                        file_id
                    );
                    return 'queued';
                }
            } catch (ex) {
                logger.error(ex);
                throw new HttpException('Error updating columns', HttpStatus.INTERNAL_SERVER_ERROR);
            }
        } else {
            const updated = [];
            const res = await this.web_file_manager.batch_update_row(
                account.id,
                file_id,
                web_file_type,
                data,
                updated
            );
            await this.webhook_svc.emit(account.id, file_id, 'row.updated', updated);
            return res;
        }
    }

    async batch_create_internal(account, file_id, web_file_type, data) {
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.check_table_lock(file_id);
        await this.batch_create(account, file_id, web_file_type, data);
    }

    private async batch_create(account, file_id, web_file_type, data) {
        data = assert_array_body(data);
        if (web_file_type === 'data_grid_row') {
            await this.tracking_manager.add_rows(account, {
                rows_to_be_added: data.length,
                file_id
            });
        }
        const inserted = [];
        const res = await this.web_file_manager.batch_create(
            account.id,
            file_id,
            web_file_type,
            data,
            inserted
        );
        if (web_file_type === 'data_grid_row') {
            await this.webhook_svc.emit(account.id, file_id, 'row.created', inserted);
        }
        return res;
    }

    async batch_delete(account, file_id, web_file_type, data) {
        // Which rows are really there, for the webhooks that want deletes (#140)
        let deleted_ids: string[] = [];
        const is_rows = web_file_type === 'data_grid_row';
        if (is_rows && Array.isArray(data)) {
            if (await this.webhook_svc.wants(account.id, file_id, 'row.deleted')) {
                const ids = data.filter(d => typeof d === 'string');
                deleted_ids = await this.web_file_manager.existing_row_ids(
                    account.id,
                    file_id,
                    ids
                );
            }
        }
        const removed_rows_count = await this.web_file_manager.batch_delete(
            account.id,
            file_id,
            web_file_type,
            data
        );
        if (is_rows) {
            await this.tracking_manager.deleted_rows(account, {
                file_id
            });
            await this.webhook_svc.emit(account.id, file_id, 'row.deleted', deleted_ids);
        }
        return removed_rows_count;
    }

    async file_upload(account, form_data) {
        await this.job_manager.create({
            account_id: account.id,
            file_id: form_data.file_id,
            file_name: form_data.file_name,
            status: 'PENDING',
            event: 'FILE_UPLOAD'
        });

        this.web_file_prc_notify_svc.job_start(
            _c.HORIZON_FS_WS_CLIENT_ID,
            account.id,
            form_data.file_id
        );
    }

    remove_file(file_path) {
        try {
            fs.unlinkSync(file_path);
        } catch (ex) {
            logger.debug(ex.message);
        }
    }
}
