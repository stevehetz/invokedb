import { Injectable } from '@nestjs/common';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { MongoDbCollections } from '../mongodb/collections';
import { TrackingManager } from '../tracking/tracking.manager';
import { WebsocketClientStore } from '@app/websocket/client.store';
import logger from '@app/logger';
import _c from '@app/constants';
import env from '@app/env';

const fs = require('fs');
const { parse: csv } = require('csv-parse');

// State for one CSV import. Kept per job (never on the singleton) so that two imports running
// at the same time can't overwrite each other's rows, counters or flags.
interface CsvJob {
    account: any;
    file_id: number;
    file_path: string;
    deadline: number;
    cancelled: boolean;
    row_index: number;
    grid_rows: any[];
}

@Injectable()
export class CsvProcessor {
    batch_size = 10000;

    // Running imports by file id, so a FILE_DELETE_REQUEST can cancel the right one.
    private active_jobs = new Map<number, CsvJob>();

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
            const job = this.active_jobs.get(file_id);
            if (job) job.cancelled = true;
        }
    }

    async csv_to_data_grid(account, file_id, file_path) {
        const job: CsvJob = {
            account,
            file_id,
            file_path,
            deadline: Date.now() + _c.JOB_PROCESSOR_TIMEOUT_MIN * 60 * 1000,
            cancelled: false,
            row_index: 1,
            grid_rows: []
        };
        this.active_jobs.set(file_id, job);
        try {
            const total_rows = await this.count_rows(file_path);
            if (total_rows === -1) {
                throw { message: 'No data to process' };
            }
            // The plan's rows per table and rows per account (#183); the table is new
            await this._tracking_manager.validate_row_count(account, total_rows, file_id);
            const first_line = await this.read_first_line(file_path);
            await this.process_columns(job, first_line);
            await this.read_and_process_rows(job);
        } finally {
            if (this.active_jobs.get(file_id) === job) this.active_jobs.delete(file_id);
        }
    }

    private check_job(job: CsvJob) {
        if (job.cancelled) {
            throw new Error('File delete request');
        }
        if (Date.now() > job.deadline) {
            throw new Error(`Job timed out after ${_c.JOB_PROCESSOR_TIMEOUT_MIN} minutes`);
        }
    }

    private count_rows(file_path): Promise<number> {
        return new Promise((resolve, reject) => {
            let i;
            let count = 0;
            fs.createReadStream(file_path)
                .on('data', chunk => {
                    for (i = 0; i < chunk.length; ++i) if (chunk[i] === 10) count++;
                })
                .on('end', () => resolve(count - 1))
                .on('error', err => reject(err));
        });
    }

    // Async iteration over the parser pauses the file stream while each record is handled
    // (backpressure), so batches are inserted in order and every insert is awaited.
    private async *read_records(file_path) {
        const read_stream = fs.createReadStream(file_path);
        const parser = csv({ delimiter: ',' });
        read_stream.on('error', err => parser.destroy(err));
        try {
            for await (const record of read_stream.pipe(parser)) {
                yield record;
            }
        } finally {
            read_stream.destroy();
            parser.destroy();
        }
    }

    private async read_first_line(file_path) {
        for await (const record of this.read_records(file_path)) {
            return record;
        }
        throw { message: 'No data to process' };
    }

    private async process_columns(job: CsvJob, csv_line) {
        const { account, file_id } = job;
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

    private async read_and_process_rows(job: CsvJob) {
        const hrtime = process.hrtime as any;
        const start = parseInt(hrtime.bigint(), 10);

        let is_header = true;
        for await (const record of this.read_records(job.file_path)) {
            if (is_header) {
                is_header = false;
                continue;
            }
            await this.process_row(job, record);
        }
        // Insert the remaining rows if any
        await this.insert_rows(job);

        const end = parseInt(hrtime.bigint(), 10);
        const seconds = (end - start) / 1e9;
        logger.info(`Processed ${job.row_index - 1} rows in ${seconds} seconds`);
    }

    private async process_row(job: CsvJob, csv_line) {
        this.check_job(job);
        let column_key = 'a';
        const grid_row = { file_directory_id: job.file_id, row_index: job.row_index };
        csv_line.forEach(csv_cell => {
            this._web_file_manager.validate_field(csv_cell);
            grid_row[column_key] = csv_cell;
            column_key = this._web_file_manager.get_next_column_key(column_key);
        });
        job.grid_rows.push(grid_row);
        job.row_index++;
        if (job.grid_rows.length >= this.batch_size) {
            await this.insert_rows(job);
        }
    }

    private async insert_rows(job: CsvJob) {
        if (job.grid_rows.length === 0) return;
        const rows = job.grid_rows;
        job.grid_rows = [];
        const row_coll = await this._collections.get_dg_collection(
            'data_grid_row',
            job.account.id,
            job.file_id
        );
        await row_coll.insertMany(rows);
    }
}
