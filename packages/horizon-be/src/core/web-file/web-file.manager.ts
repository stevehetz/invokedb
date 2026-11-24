import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { MongoDbCollections } from '../mongodb/collections';
import { TrackingManager } from '../tracking/tracking.manager';
import { Account } from '../account/account.entity';
import _c from '@app/constants';
import logger from '@app/logger';
import { parse_utc_date, format_date } from '../date';
import { assert_array_body } from '../helpers/array-body';

const MAX_FIELD_VALUE_LENGTH = 2000;
const MAX_COLUMN_VALUE_LENGTH = 100;

@Injectable()
export class WebFileManager {
    constructor(
        private _collections: MongoDbCollections,
        private _tracking_manager: TrackingManager,
        @InjectRepository(Account)
        private readonly account_repository: Repository<Account>
    ) {}

    async get_new_column(acct_id, file_id) {
        const c = await this._collections.get_dg_col(acct_id, file_id);
        const data = await c.find({}).toArray();
        const last_col = data.length > 0 ? data[data.length - 1] : null;
        const new_key = last_col ? this.get_next_column_key(last_col.field) : 'a';

        const new_col = {
            file_directory_id: parseInt(file_id, 10),
            col_index: last_col ? last_col.col_index + 1 : 1,
            order: last_col ? last_col.col_index + 1 : 1,
            field: new_key,
            headerName: '',
            width: 200,
            deleted: true
        };
        const res = await c.insertOne(new_col);
        return { ...new_col, _id: res.insertedId };
    }

    async get_all(acct_id, file_id, collection, page_params: any = {}) {
        this.validate_params(collection, page_params);
        const res = await this.get_all_query(acct_id, file_id, collection, page_params);
        // Row num searches
        if (page_params.filters && page_params.filters.row_num)
            return await this.row_search(acct_id, file_id, collection, page_params, res.count);

        return res;
    }

    validate_params(collection, params) {
        if (collection === 'data_grid_row' && (!params || !params.skip || !params.limit)) {
            throw new HttpException(
                `Must provide 'skip' and 'limit' query parameters`,
                HttpStatus.BAD_REQUEST
            );
        }

        const { limit } = params;

        if (limit > 1000) {
            throw new HttpException(
                `Query parameter 'limit' cannot exceed 1000`,
                HttpStatus.BAD_REQUEST
            );
        }
    }

    async row_search(acct_id, file_id, collection, page_params, count) {
        let params = this.row_num_search_params(page_params, count);
        params = Object.assign({}, page_params, params);
        if (params.skip < 0) return { count: 0, data: [] };
        const row_search_res = await this.get_all_query(acct_id, file_id, collection, params);
        row_search_res.count = row_search_res.data.length > 0 ? 1 : 0;
        return row_search_res;
    }

    row_num_search_params(page_params, count) {
        const f_row_num = page_params.filters.row_num.value;
        const limit = 1;
        let skip = null;

        try {
            const parsed = parseInt(f_row_num, 10);
            if (isNaN(parsed) || parsed === undefined || parsed === null) skip = -1;
            else if (page_params.sort_dir === 'desc') skip = count - parseInt(f_row_num, 10);
            else skip = parseInt(f_row_num, 10) - 1;
        } catch (ex) {
            skip = -1;
        }

        return { skip, limit };
    }

    format_data_response(rows, col_type_map) {
        return rows.map(row => this.format_row_response(row, col_type_map));
    }

    format_row_response(row, col_type_map) {
        Object.keys(row).forEach(field => {
            if (row[field] && col_type_map[field]) {
                if (col_type_map[field] === 'date') {
                    row[field] = this.format_date_field(row[field]);
                }
            }
        });
        return row;
    }

    format_date_field(value) {
        try {
            // `SS` is hundredths of a second, as it was with moment (see the PR for #14)
            value = format_date(parse_utc_date(value), 'YYYY-MM-DD hh:mm:SS A', true);
        } catch (ex) {}
        return value;
    }

    add_row_numbers(params, count, docs) {
        const sort_direction = params.sort_by === 'row_num' && params.sort_dir === 'desc' ? -1 : 1;
        const data = [];
        let i = 0;
        docs.forEach(doc => {
            const row_num = this.get_row_num(params.skip, sort_direction, i, count);
            data.push(Object.assign({ row_num }, doc));
            i = i + sort_direction;
        });
        return data;
    }

    get_row_num(skip, sort_direction, i, count) {
        skip = skip ? parseInt(skip, 10) : 0;
        return sort_direction !== -1 ? i + skip + 1 : count + (i - skip);
    }

    async get_all_query(acct_id, file_id, collection, page_params) {
        const collection_obj = await this._collections.get_dg_collection(
            collection,
            acct_id,
            file_id
        );

        const find_obj = this.get_find_obj(page_params);

        if (collection === 'data_grid_column') {
            find_obj.deleted = { $ne: true };
        }

        let data;

        if (this.has_paging) {
            if (page_params.limit === '0') {
                return { count: 0, data: [] };
            }

            if (page_params.sort_dir) {
                let sort_by = page_params.sort_by;
                const sort_direction = page_params.sort_dir === 'desc' ? -1 : 1;
                if (sort_by === 'row_num') sort_by = 'row_index';
                if (page_params.filters && page_params.filters.$group) {
                    const query: any = [
                        { $group: { _id: '$' + page_params.filters.$group } },
                        { $sort: { _id: sort_direction } },
                        { $skip: parseInt(page_params.skip, 10) },
                        { $limit: parseInt(page_params.limit, 10) }
                    ];
                    if (find_obj && Object.keys(find_obj).length > 0) {
                        query.unshift({ $match: find_obj });
                    }

                    data = await collection_obj.aggregate(query).toArray();
                } else {
                    data = await collection_obj
                        .find(find_obj)
                        .sort({ [sort_by]: sort_direction })
                        .skip(parseInt(page_params.skip, 10))
                        .limit(parseInt(page_params.limit, 10))
                        .toArray();
                }
            } else {
                if (page_params.filters && page_params.filters.$group) {
                    const query: any = [
                        { $group: { _id: '$' + page_params.filters.$group } },
                        { $skip: parseInt(page_params.skip, 10) },
                        { $limit: parseInt(page_params.limit, 10) }
                    ];
                    if (find_obj && Object.keys(find_obj).length > 0) {
                        query.unshift({ $match: find_obj });
                    }
                    data = await collection_obj.aggregate(query).toArray();
                } else {
                    data = await collection_obj
                        .find(find_obj)
                        .skip(parseInt(page_params.skip, 10))
                        .limit(parseInt(page_params.limit, 10))
                        .toArray();
                }
            }
        } else {
            if (page_params.filters.$group) {
                const query: any = [{ $group: { _id: '$' + page_params.filters.$group } }];
                if (find_obj && Object.keys(find_obj).length > 0) {
                    query.unshift({ $match: find_obj });
                }
                data = await collection_obj.aggregate(query).toArray();
            } else {
                data = await collection_obj.find(find_obj).toArray();
            }
        }

        if (page_params.filters && page_params.filters.$group) {
            const query: any = [{ $group: { _id: '$' + page_params.filters.$group } }];
            if (find_obj && Object.keys(find_obj).length > 0) {
                query.unshift({ $match: find_obj });
            }
            const all_data = await collection_obj.aggregate(query).toArray();

            const count = all_data.length;
            data = data.map(d => {
                return { [page_params.filters.$group]: d._id };
            });
            return { data, count };
        } else {
            const count = await collection_obj.countDocuments(find_obj);
            const col_type_map = await this.get_col_type_map(acct_id, file_id);
            data = this.format_data_response(data, col_type_map);
            data = this.add_row_numbers(page_params, count, data);
            return { data, count };
        }
    }

    get_find_obj(params) {
        if (!params || !params.filters) return {};
        if (Object.keys(params.filters).length === 0) return {};
        const mongodb_filters: any = { $and: [] };

        if (params && params.filters) {
            if (params.filters.$or) {
                mongodb_filters.$or = this.create_find_obj_part(params.filters.$or);
                if (mongodb_filters.$or.length === 0) {
                    delete mongodb_filters.$or;
                }
            }

            mongodb_filters.$and = this.create_find_obj_part(params.filters);
            if (mongodb_filters.$and.length === 0) {
                delete mongodb_filters.$and;
            }
        }

        return mongodb_filters;
    }

    create_find_obj_part(filters) {
        const new_filters = [];
        for (const key in filters) {
            if (key !== 'row_num' && key !== '$or' && key !== '$group') {
                if (Array.isArray(filters[key])) {
                    filters[key].forEach(filter => {
                        this.validate_filter_param(filter, key);
                        new_filters.push({ [key]: this.build_find_obj(filter) });
                    });
                } else {
                    if (key === '_id') {
                        new_filters.push({ [key]: new ObjectId(filters[key]) });
                    } else {
                        const filter = filters[key];
                        this.validate_filter_param(filter, key);
                        new_filters.push({ [key]: this.build_find_obj(filter) });
                    }
                }
            }
        }

        return new_filters;
    }

    validate_filter_param(filter, key) {
        const num_types = [
            'equals',
            'lessThan',
            'lessThanOrEqual',
            'greaterThan',
            'greaterThanOrEqual'
        ];
        const string_types = ['equals', 'contains'];

        if (filter.value === undefined || filter.value === null || !filter.type) {
            throw new HttpException(
                'Filter parameter must contain at least a value and a type',
                HttpStatus.BAD_REQUEST
            );
        }

        if (
            (filter.col_type === 'number' || filter.col_type === 'date') &&
            num_types.indexOf(filter.type) === -1
        ) {
            throw new HttpException(
                `${filter.type} is not a valid filter type for a ${filter.col_type}`,
                HttpStatus.BAD_REQUEST
            );
        }

        if (filter.col_type === 'string' && string_types.indexOf(filter.type) === -1) {
            throw new HttpException(
                `${filter.type} is not a valid filter type for a ${filter.col_type}`,
                HttpStatus.BAD_REQUEST
            );
        }
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    build_find_obj(filter) {
        if (filter.col_type === 'date') {
            try {
                filter.value = parse_utc_date(filter.value);
            } catch (ex) {}
        }
        if (filter.type === 'contains') {
            if (Array.isArray(filter.value)) {
                return {
                    $in: filter.value.map(value => {
                        return new RegExp(
                            this.escapeRegExp(value),
                            filter.case === 'insensitive' ? 'i' : ''
                        );
                    })
                };
            }
            return {
                $regex: new RegExp(
                    this.escapeRegExp(filter.value),
                    filter.case === 'insensitive' ? 'i' : ''
                )
            };
        } else if (filter.type === 'equals') {
            if (Array.isArray(filter.value)) {
                return {
                    $in: filter.value.map(value => {
                        if (filter.col_type === 'string') {
                            return new RegExp(
                                '^' + this.escapeRegExp(value) + '$',
                                filter.case === 'insensitive' ? 'i' : ''
                            );
                        } else {
                            return value;
                        }
                    })
                };
            }
            if (filter.col_type === 'string') {
                return new RegExp(
                    '^' + this.escapeRegExp(filter.value) + '$',
                    filter.case === 'insensitive' ? 'i' : ''
                );
            } else {
                return filter.value;
            }
        } else if (filter.type === 'lessThan') {
            return {
                $lt: filter.value
            };
        } else if (filter.type === 'lessThanOrEqual') {
            return {
                $lte: filter.value
            };
        } else if (filter.type === 'greaterThan') {
            return {
                $gt: filter.value
            };
        } else if (filter.type === 'greaterThanOrEqual') {
            return {
                $gte: filter.value
            };
        }
    }

    has_paging(params) {
        if (!params.skip) return false;
        if (!params.limit) return false;
        return true;
    }

    async create_new(acct_id, file_id, web_file_type) {
        if (web_file_type === 'data-grid') {
            const new_rows = [this.new_row(file_id), this.new_row(file_id), this.new_row(file_id)];
            const account = await this.account_repository.findOneBy({ id: acct_id });
            await this._tracking_manager.add_rows(account, {
                rows_to_be_added: new_rows.length,
                file_id
            });
            const row_coll = await this._collections.get_dg_row(acct_id, file_id);
            await row_coll.insertMany(new_rows);
            const col_coll = await this._collections.get_dg_col(acct_id, file_id);
            const new_cols = [
                {
                    file_directory_id: file_id,
                    col_index: 1,
                    field: 'a',
                    order: 1,
                    headerName: 'column1',
                    width: 200
                },
                {
                    file_directory_id: file_id,
                    col_index: 2,
                    field: 'b',
                    order: 2,
                    headerName: 'column2',
                    width: 200
                },
                {
                    file_directory_id: file_id,
                    col_index: 3,
                    field: 'c',
                    order: 3,
                    headerName: 'column3',
                    width: 200
                }
            ];
            await col_coll.insertMany(new_cols);
        }
    }

    new_row(file_id) {
        return {
            file_directory_id: file_id,
            row_index: 1,
            a: '',
            b: '',
            c: ''
        };
    }

    async batch_create(acct_id, file_id, web_file_type, data) {
        data = assert_array_body(data);
        data.forEach(row => this.validate_row(row));
        file_id = parseInt(file_id, 10);
        if (web_file_type === _c.MongoDbCollections.data_grid_row) {
            let last_row_index = await this.get_last_grid_row_index(acct_id, file_id);
            data.forEach(d => {
                if (d._id) delete d._id;
                if (d.row_num) delete d.row_num;
                d.file_directory_id = file_id;
                d.row_index = ++last_row_index;
            });
            const col_type_map = await this.get_col_type_map(acct_id, file_id);
            const formatted_data = data.map(row => {
                return this.format_row(row, col_type_map);
            });
            const row_coll = await this._collections.get_dg_row(acct_id, file_id);
            await row_coll.insertMany(formatted_data);
        } else if (web_file_type === _c.MongoDbCollections.data_grid_column) {
            const col_coll = await this._collections.get_dg_col(acct_id, file_id);
            await col_coll.insertMany(data);
        } else {
            throw new Error('Web file type: batch_create not implemented');
        }
        return data.length;
    }

    async get_last_grid_row_index(acct_id, file_id) {
        const row_coll = await this._collections.get_dg_row(acct_id, file_id);
        const doc = await row_coll.findOne(
            {
                file_directory_id: file_id
            },
            {
                sort: { row_index: -1 }
            }
        );
        return doc ? doc.row_index : 0;
    }

    async get_last_grid_column(acct_id, file_id) {
        file_id = parseInt(file_id, 10);
        const col_coll = await this._collections.get_dg_col(acct_id, file_id);
        const doc = await col_coll.findOne(
            {
                file_directory_id: file_id
            },
            {
                sort: { col_index: -1 }
            }
        );
        return doc;
    }

    async batch_update_column(acct_id, file_id, collection, data) {
        if (data && Array.isArray(data)) {
            for (const row of data) {
                await this.update(acct_id, file_id, collection, row);
            }
        }

        return 'done';
    }

    async batch_update_row(acct_id, file_id, collection, data) {
        const res = [];
        if (data && Array.isArray(data)) {
            for (const row of data) {
                res.push(await this.update(acct_id, file_id, collection, row));
            }
        }
        return res.length;
    }

    async update(acct_id, file_id, collection, data) {
        if (collection === 'data_grid_column') {
            return await this.update_dg_column(acct_id, file_id, data);
        } else if (collection === 'data_grid_row') {
            return await this.update_dg_row(acct_id, file_id, data);
        }

        throw new Error('collection not supported for update');
    }

    async update_dg_column(acct_id, file_id, data) {
        const _id = new ObjectId(data._id);
        delete data._id;
        delete data.row_num;

        const col_coll = await this._collections.get_dg_col(acct_id, file_id);
        const all_columns = await col_coll.find({ deleted: { $ne: true } }).toArray();
        const original = await col_coll.findOne({ _id });
        if (!original) {
            throw new Error('Column not found');
        }

        original.col_type = original.col_type || 'string';
        data.col_type = data.col_type || 'string';

        if (data.headerName !== undefined && original.headerName !== data.headerName) {
            this.validate_column_header(all_columns, data.headerName);
        }

        if (original.indexed !== data.indexed) {
            const { field } = data;
            const row_coll = await this._collections.get_dg_row(acct_id, file_id);
            const index_info = await row_coll.indexInformation();

            let indexes = [];
            if (index_info && index_info._id_) {
                indexes = Object.keys(index_info).filter(key => key.startsWith(field + '_'));
            }
            for (const index of indexes) {
                await row_coll.dropIndex(index);
            }

            if (data.indexed) {
                await row_coll.createIndex(field);
            }
        }

        const res = await col_coll.findOneAndUpdate(
            {
                _id
            },
            { $set: data },
            { returnDocument: 'after', includeResultMetadata: true }
        );

        if (original.col_type !== data.col_type) {
            // Per call, not on the singleton, so concurrent type changes don't share a timeout.
            const deadline = Date.now() + _c.JOB_PROCESSOR_TIMEOUT_MIN * 60 * 1000;

            const { field } = data;
            const row_coll = await this._collections.get_dg_row(acct_id, file_id);
            const BATCH_SIZE = 1000;
            let ops = [];
            for await (const doc of row_coll.find({})) {
                this.check_timeout_error(deadline);
                const value = this.format_row_value(doc[field], data.col_type);
                ops.push({
                    updateOne: { filter: { _id: doc._id }, update: { $set: { [field]: value } } }
                });
                if (ops.length === BATCH_SIZE) {
                    await row_coll.bulkWrite(ops, { ordered: false });
                    ops = [];
                }
            }
            if (ops.length > 0) {
                await row_coll.bulkWrite(ops, { ordered: false });
            }
        }

        return res && res.value && res.value.count ? res.value.count : res;
    }

    check_timeout_error(deadline: number) {
        if (Date.now() > deadline) {
            throw new Error(`Job timed out after ${_c.JOB_PROCESSOR_TIMEOUT_MIN} minutes`);
        }
    }

    async get_col_type_map(acct_id, file_id) {
        const col_coll = await this._collections.get_dg_col(acct_id, file_id);
        const cols = await col_coll.find({}).toArray();
        const add_to_map = (map, col) => (map[col.field] = col.col_type || 'string') && map;
        return cols.reduce(add_to_map, {});
    }

    async update_dg_row(acct_id, file_id, data) {
        const _id = new ObjectId(data._id);
        delete data._id;
        delete data.row_num;
        this.validate_row(data);
        const col_type_map = await this.get_col_type_map(acct_id, file_id);
        const formatted_row = this.format_row(data, col_type_map);
        const row_coll = await this._collections.get_dg_row(acct_id, file_id);
        const res = await row_coll.findOneAndUpdate(
            {
                _id
            },
            { $set: formatted_row },
            { returnDocument: 'after', includeResultMetadata: true }
        );

        return res && res.value ? this.format_row_response(res.value, col_type_map) : null;
    }

    format_row(row, col_type_map) {
        const new_row = {};
        Object.keys(row).forEach(key => {
            if (key !== 'file_directory_id' && key !== 'row_index') {
                new_row[key] = this.format_row_value(row[key], col_type_map[key]);
            } else {
                new_row[key] = row[key];
            }
        });
        return new_row;
    }

    format_row_value(value, type) {
        try {
            if (value === undefined || value === null || (value.trim && value.trim() === '')) {
                value = null;
            } else if (type === 'string') {
                value = value.toString();
            } else if (type === 'number') {
                value = parseFloat(value);
                value = isNaN(value) ? null : value;
            } else if (type === 'date') {
                if (value.trim && value.trim() === '') {
                    value = null;
                } else {
                    value = parse_utc_date(value);
                }
            }
        } catch (ex) {}

        return value;
    }

    async batch_delete(acct_id, file_id, collection, data) {
        data = data.map(d => new ObjectId(d));
        if (collection === 'data_grid_row') {
            const coll = await this._collections.get_dg_collection(collection, acct_id, file_id);
            const res = await coll.deleteMany({
                _id: { $in: data }
            });
            if (res && res.deletedCount) {
                return res.deletedCount;
            }
            return 0;
        } else if (collection === 'data_grid_column') {
            data.forEach(async _id => {
                const res = await this.update(acct_id, file_id, collection, {
                    _id,
                    deleted: true
                });

                if (res.value && res.value.field) {
                    const { field } = res.value;
                    const row_coll = await this._collections.get_dg_row(acct_id, file_id);
                    row_coll.updateMany({}, { $unset: { [field]: '' } });
                }
            });
            return 'success';
        } else {
            throw new Error('Not a valid collection');
        }
    }

    get_next_column_key(key) {
        let new_key;
        if (key.length === 1) {
            const letter = key;
            if (letter === 'z') {
                new_key = 'a0';
            } else {
                const code = letter.charCodeAt(0) + 1;
                new_key = String.fromCharCode(code);
            }
        } else {
            let letter = key.substring(0, 1);
            let number = parseInt(key.substring(1), 10);
            if (letter === 'z') {
                new_key = `a${++number}`;
            } else {
                letter = String.fromCharCode(letter.charCodeAt(0) + 1);
                new_key = `${letter}${number}`;
            }
        }

        return new_key;
    }

    validate_column_header(columns, name) {
        const reserved = ['$or', '$and', 'row', 'row_num', 'row num', 'rownum'];
        const names = columns.map(c => c.headerName);
        const regex = new RegExp(/^[A-Za-z0-9-_\s\.\$!]+$/, 'g');
        // A missing or non-string name (no headerName in the body) is an empty column, not a 500
        if (typeof name !== 'string' || name.trim() === '') {
            throw new HttpException('Columns cannot be empty', HttpStatus.FORBIDDEN);
        } else if (names.includes(name)) {
            throw new HttpException(`Duplicate column name: ${name}`, HttpStatus.FORBIDDEN);
        } else if (reserved.indexOf(name.toLowerCase()) > -1) {
            throw new HttpException(`${name} is a reserved column name`, HttpStatus.FORBIDDEN);
        } else if (name.length > MAX_COLUMN_VALUE_LENGTH) {
            throw new HttpException(
                `Column value cannot be greater than ${MAX_COLUMN_VALUE_LENGTH} characters`,
                HttpStatus.FORBIDDEN
            );
        } else if (!regex.test(name)) {
            throw new HttpException(
                `Column name error: ${name}.\nValid characters are A-Za-z0-9-_$!. and spaces`,
                HttpStatus.FORBIDDEN
            );
        }
    }

    validate_row(row) {
        try {
            Object.keys(row).forEach(key => this.validate_field(row[key]));
        } catch (ex) {
            throw new HttpException(ex.message, HttpStatus.FORBIDDEN);
        }
    }

    validate_field(value) {
        if (value && value.toString().length > MAX_FIELD_VALUE_LENGTH) {
            throw new Error(
                `Field values cannot be longer than ${MAX_FIELD_VALUE_LENGTH} characters`
            );
        }
    }

    async delete_dg(account, file_id) {
        const col = await this._collections.get_dg_col(account.id, file_id);
        await col.drop();
        const row = await this._collections.get_dg_row(account.id, file_id);
        await row.drop();
        const row_count = await this._tracking_manager.get_tracking_row_count_collection(account);
        await row_count.deleteOne({ file_id });
    }
}
