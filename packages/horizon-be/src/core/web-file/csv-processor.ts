import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { MongoDbCollections } from '../mongodb/collections';
import { TrackingManager } from '../tracking/tracking.manager';
import { WebsocketClientStore } from '@app/websocket/client.store';
import { FileDirectory } from '../file-directory/file-directory.entity';
import logger from '@app/logger';
import _c from '@app/constants';
import env from '@app/env';

const fs = require('fs');
const { parse: csv } = require('csv-parse');

@Injectable()
export class CsvProcessor {
    batch_size = 10000;
    processed_columns;
    row_total;
    row_index;
    grid_rows;
    fe_ws_client;

    throw_timeout_error = false;
    file_delete_request_id = null;

    constructor(
        private _collections: MongoDbCollections,
        private _web_file_manager: WebFileManager,
        private _tracking_manager: TrackingManager,
        private _ws_client_store: WebsocketClientStore
    ) {
        if (env.IS_HORIZON_PRC) {
            this._ws_client_store.on_direct_message(_c.HORIZON_PRC_WS_CLIENT_ID, async payload =>
                this.on_prc_ws_message(payload)
            );
        }
    }

    async on_prc_ws_message(payload) {
        const { event, file_id } = payload;
        if (event && event === 'FILE_DELETE_REQUEST') {
            this.file_delete_request_id = file_id;
        }
    }

    async csv_to_data_grid(account, file_id, file_path) {
        this.row_total = 0;
        this.row_index = 1;
        this.grid_rows = [];
        this.throw_timeout_error = false;

        return new Promise(async (resolve, reject) => {
            try {
                setTimeout(() => {
                    this.throw_timeout_error = true;
                }, _c.JOB_PROCESSOR_TIMEOUT_MIN * 1000 * 60);
                const total_rows = await this.count_rows(file_path);
                if (total_rows === -1) {
                    return reject({ message: 'No data to process' });
                }
                await this._tracking_manager.validate_row_count(account, total_rows);
                const first_line = await this.read_first_line(file_path);
                await this.process_columns(account, file_id, first_line);
                await this.read_and_process_rows(account, file_id, file_path);

                resolve(undefined);
            } catch (ex) {
                reject(ex);
            }
        });
    }

    check_timeout_error() {
        if (this.throw_timeout_error) {
            throw new Error(`Job timed out after ${_c.JOB_PROCESSOR_TIMEOUT_MIN} minutes`);
        }
    }

    check_file_delete_request(file_id) {
        if (this.file_delete_request_id === file_id) {
            throw new Error('File delete request');
        }
    }

    private count_rows(file_path) {
        return new Promise((resolve, reject) => {
            let i;
            let count = 0;
            require('fs')
                .createReadStream(file_path)
                .on('data', chunk => {
                    for (i = 0; i < chunk.length; ++i) if (chunk[i] == 10) count++;
                })
                .on('end', () => resolve(count - 1))
                .on('error', err => reject(err));
        });
    }

    private read_first_line(file_path) {
        return new Promise((resolve, reject) => {
            const readStream = fs.createReadStream(file_path);
            readStream
                .pipe(csv({ delimiter: ',' }))
                .on('data', async data => {
                    readStream.destroy();
                    resolve(data);
                })
                .on('error', err => reject(err));
        });
    }

    private async process_columns(account, file_id, csv_line) {
        this.processed_columns = true;
        let column_key = 'a';
        let grid_column_index = 1;
        const grid_columns = [];
        csv_line.forEach(csv_cell => {
            this._web_file_manager.validate_column_header(grid_columns, csv_cell);
            grid_columns.push({
                file_directory_id: file_id,
                headerName: csv_cell,
                field: column_key,
                width: 200,
                order: grid_column_index,
                col_index: grid_column_index
            });
            column_key = this._web_file_manager.get_next_column_key(column_key);
            grid_column_index++;
        });
        await this._tracking_manager.validate_column_count(account, file_id, grid_columns.length);
        const col_coll = await this._collections.get_dg_collection(
            'data_grid_column',
            account.id,
            file_id
        );
        await col_coll.insertMany(grid_columns);
    }

    private async read_and_process_rows(account, file_id, file_path) {
        const hrtime = process.hrtime as any;
        const start = parseInt(hrtime.bigint(), 0);

        return new Promise((resolve, reject) => {
            try {
                let i = 0;
                const readStream = fs.createReadStream(file_path);
                readStream
                    .pipe(csv({ delimiter: ',' }))
                    .on('data', async data => {
                        try {
                            if (++i === 1) return;
                            await this.process_rows(account, file_id, data);
                        } catch (ex) {
                            reject(ex);
                            readStream.destroy();
                        }
                    })
                    .on('error', err => reject(err))
                    .on('end', async () => {
                        // Insert the remaining rows if any
                        await this.insert_rows(account, file_id);
                        const end = parseInt(hrtime.bigint(), 10);
                        const seconds = (end - start) / 1e9;
                        logger.info(`Processed ${this.row_index - 1} rows in ${seconds} seconds`);
                        resolve(undefined);
                    });
            } catch (ex) {
                reject(ex);
            }
        });
    }

    private async process_rows(account, file_id, csv_line) {
        this.check_file_delete_request(file_id);
        this.check_timeout_error();
        let column_key = 'a';
        const grid_row = { file_directory_id: file_id, row_index: this.row_index };
        csv_line.forEach(csv_cell => {
            this._web_file_manager.validate_field(csv_cell);
            grid_row[column_key] = csv_cell;
            column_key = this._web_file_manager.get_next_column_key(column_key);
        });
        this.grid_rows.push(grid_row);
        if (this.grid_rows.length === this.batch_size) {
            await this.insert_rows(account, file_id);
        }
        this.row_index++;
    }

    private async insert_rows(account, file_id) {
        const row_coll = await this._collections.get_dg_collection(
            'data_grid_row',
            account.id,
            file_id
        );

        return new Promise(resolve => {
            if (this.grid_rows.length > 0) row_coll.insertMany(this.grid_rows);

            // logger.debug('CSV Processor - Rows processed: ' + (this.row_index - 1));
            this.grid_rows = [];
            resolve(undefined);
        });
    }
}
