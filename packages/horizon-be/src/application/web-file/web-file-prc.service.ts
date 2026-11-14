import { Injectable } from '@nestjs/common';
import { CsvProcessor } from '@app/core/web-file/csv-processor';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { JobManager } from '@app/core/job/job.manager';
import { WebsocketClientStore } from '@app/websocket/client.store';
import env from '@app/env';
import _c from '@app/constants';
import logger from '@app/logger';
import { AccountService } from '../account/account.service';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { WebFilePrcNotifyService } from './web-file-prc-notify.service';
import { MongoDbCollections } from '@app/core/mongodb/collections';

const fs = require('fs');

@Injectable()
export class WebFilePrcService {
    constructor(
        private account_svc: AccountService,
        private web_file_manager: WebFileManager,
        private file_directory_svc: FileDirectoryService,
        private csv_processor: CsvProcessor,
        private job_manager: JobManager,
        private _ws_client_store: WebsocketClientStore,
        private web_file_prc_notify_svc: WebFilePrcNotifyService,
        private _collections: MongoDbCollections
    ) {
        if (env.IS_HORIZON_PRC) {
            this._ws_client_store.on_direct_message(_c.HORIZON_PRC_WS_CLIENT_ID, async payload =>
                this.on_prc_ws_message(payload)
            );

            this.start_file_processor();
        }
    }

    start_file_processor() {
        fs.rm(_c.PRC_TMP_DIR, { recursive: true, force: true }, () => {});

        setTimeout(() => {
            this.wake_file_processor();
            setInterval(() => {
                this.wake_file_processor();
            }, _c.JOB_PROCESSOR_SLEEP_INTERVAL_SEC * 1000);
        }, 5000);
    }

    async on_prc_ws_message(payload) {
        const { event, file_id } = payload;
        if (event && event === 'RUN_JOB_PROCESSOR') {
            this.wake_file_processor();
        }
        if (event && event === 'FILE_DELETE_REQUEST') {
            this.file_delete_request(file_id);
        }
    }

    async wake_file_processor() {
        if (this.job_manager.job_state === 'SLEEPING') {
            // logger.debug(`${env.SERVER_NAME} job processor waking up...`);
            this.check_for_jobs();
        } else {
            // logger.debug(`${env.SERVER_NAME} is already running`);
        }
    }

    async file_delete_request(file_id) {
        const jobs = await this.job_manager.get_running_jobs();
        jobs.filter(job => job.file_id === file_id).forEach(async job => {
            try {
                const { id, account_id, file_name } = job;
                const file_path = `${env.HORIZON_FILE_SHARE}/temp/${file_name}`;
                logger.debug(`Cancelling job ${id} - file ${file_id} deleted`);
                await this.job_manager.update(id, {
                    status: 'CANCELLED',
                    status_reason: 'File deleted'
                });
                const account = await this.account_svc.get(account_id);
                await this.web_file_manager.delete_dg(account, file_id);
                this.remove_file(file_path);
            } catch (ex) {
                logger.error(ex.message);
            }
        });
        this.check_for_jobs();
    }

    async check_for_jobs() {
        // logger.debug(`${env.SERVER_NAME} finding latest job`);

        const job_events = ['FILE_UPLOAD', 'COLUMN_UPDATE'];

        let job;
        try {
            job = await this.job_manager.get_latest_pending(job_events);
        } catch (ex) {}

        if (job) {
            this.job_manager.job_state = 'RUNNING';
            logger.debug(`processing ${job.event} wth id ${job.id}`);

            if (job.event === 'FILE_UPLOAD') {
                await this.file_process(job);
            } else if (job.event === 'COLUMN_UPDATE') {
                await this.column_update(job);
            }

            logger.debug(`done proccessing job, checking for another in 5s`);
            setTimeout(() => this.check_for_jobs(), 5000);
        } else {
            // logger.debug(`${env.SERVER_NAME} no jobs to process, going to sleep...`);
            this.job_manager.job_state = 'SLEEPING';
        }
    }

    async validate_file_for_processing(job_id, file) {
        if (file.deleted) {
            await this.job_manager.update(job_id, {
                status: 'ERROR',
                status_reason: 'File was deleted'
            });
            return false;
        } else if (file.locked) {
            await this.job_manager.update(job_id, {
                status: 'ERROR',
                status_reason: 'File is locked'
            });
            return false;
        } else if (file.status !== 'PENDING') {
            await this.job_manager.update(job_id, {
                status: 'ERROR',
                status_reason: 'File must be in status PENDING to be processed'
            });
            return false;
        }

        return true;
    }

    async file_process(job) {
        const { id, account_id, file_id, file_name } = job;
        const file_path = `${env.HORIZON_FILE_SHARE}/temp/${file_name}`;
        const account = await this.account_svc.get(account_id);
        try {
            const file = await this.file_directory_svc.get_by_id(file_id);
            await this.web_file_manager.delete_dg(account, file.id);

            if (job.restarts > _c.JOB_RESTART_LIMIT) {
                logger.error(`Job ${job.id} has failed. Too many restarts`);
                await this.web_file_process_error(account_id, id, file_id, {
                    message: 'Could not process file'
                });
                this.remove_file(file_path);
                return;
            }

            const is_valid = await this.validate_file_for_processing(id, file);
            if (!is_valid) {
                logger.debug(`${env.SERVER_NAME} file not valid for processing`);
                this.remove_file(file_path);
                return;
            }

            await this.csv_processor.csv_to_data_grid(account, file_id, file_path);
            this.web_file_process_complete(account_id, id, file_id);
            this.remove_file(file_path);
            return file_id;
        } catch (ex) {
            if (!ex || ex.message !== 'File delete request') {
                await this.web_file_process_error(account.id, id, file_id, ex);
                this.remove_file(file_path);
            }
        }
    }

    async web_file_process_complete(account_id, job_id, file_id) {
        this.job_manager.update(job_id, { status: 'COMPLETE' });
        await this.file_directory_svc.update(file_id, {
            status: null
        });
        this.web_file_prc_notify_svc.job_complete(_c.HORIZON_PRC_WS_CLIENT_ID, account_id, file_id);
    }

    async web_file_process_error(account_id, job_id, file_id, ex, opts: any = {}) {
        const set_file_error = opts.set_file_error === undefined ? true : opts.set_file_error;
        const send_client_message =
            opts.send_client_message === undefined ? true : opts.send_client_message;
        logger.debug(ex);
        const status_reason = ex.message ? ex.message.trim() : ex;
        if (set_file_error) {
            await this.file_directory_svc.update(file_id, {
                status: 'ERROR',
                status_reason: `File process error - ${status_reason}`
            });
        }
        this.job_manager.update(job_id, {
            status: 'ERROR',
            status_reason
        });
        if (send_client_message) {
            this.web_file_prc_notify_svc.job_error(
                _c.HORIZON_PRC_WS_CLIENT_ID,
                account_id,
                file_id,
                ex
            );
        }
    }

    async column_update(job) {
        const { id, account_id, file_id, data } = job;
        try {
            const file = await this.file_directory_svc.get_by_id(file_id);
            if (job.restarts > _c.JOB_RESTART_LIMIT) {
                logger.error(`Job ${job.id} has failed. Too many restarts`);
                const error = { message: 'Could not process file' };
                const opts = { set_file_error: false };
                await this.web_file_process_error(account_id, id, file_id, error, opts);
                return;
            }
            const is_valid = await this.validate_file_for_processing(id, file);
            if (!is_valid) {
                logger.debug(`${env.SERVER_NAME} file not valid for processing`);
                return;
            }
            const hrtime = process.hrtime as any;
            const start = parseInt(hrtime.bigint(), 0);
            await this.web_file_manager.batch_update_column(
                account_id,
                file_id,
                'data_grid_column',
                data
            );
            const end = parseInt(hrtime.bigint(), 10);
            const seconds = (end - start) / 1e9;
            logger.info(`Column update for file ${file_id} completed in ${seconds} seconds`);
            this.web_file_process_complete(account_id, id, file_id);
            return file_id;
        } catch (ex) {
            await this.file_directory_svc.update(file_id, {
                status: null,
                status_reason: null
            });
            const opts = { set_file_error: false, send_client_message: false };
            await this.web_file_process_error(account_id, id, file_id, ex, opts);
        }
    }

    remove_file(file_path) {
        try {
            fs.unlinkSync(file_path);
        } catch (ex) {
            logger.debug(ex.message);
        }
    }
}
