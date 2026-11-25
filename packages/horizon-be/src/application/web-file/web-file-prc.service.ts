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
import { UrlImportManager, UrlSource } from '@app/core/url-import/url-import.manager';
import { UrlSyncProcessor } from '@app/core/web-file/url-sync-processor';
import { fetch_source } from '@app/core/url-import/url-fetch';
import { body_to_csv, next_sync_at } from '@app/core/url-import/url-import';
import { URL_JOB_EVENTS, UrlImportService } from '../url-import/url-import.service';

const fs = require('fs');
const path = require('path');

// How often the scheduler looks for URL imports due a re-sync (#144)
const URL_SYNC_CHECK_INTERVAL_MS = 60 * 1000;

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
        private _collections: MongoDbCollections,
        private url_import_manager: UrlImportManager,
        private url_sync_processor: UrlSyncProcessor,
        private url_import_svc: UrlImportService
    ) {
        if (env.IS_HORIZON_PRC) {
            this._ws_client_store.on_direct_message(_c.HORIZON_PRC_WS_CLIENT_ID, async payload =>
                this.on_prc_ws_message(payload)
            );

            this.start_file_processor();
            this.start_url_sync_scheduler();
        }
    }

    start_url_sync_scheduler() {
        setInterval(() => {
            this.queue_due_url_syncs().catch(ex =>
                logger.error(`URL sync scheduler failed: ${ex && ex.message}`)
            );
        }, URL_SYNC_CHECK_INTERVAL_MS);
    }

    // Queues a sync for every URL import whose schedule is due. A table that's busy, locked or
    // in a locked account waits for its next turn; a deleted table's source is removed.
    async queue_due_url_syncs() {
        const now = Date.now();
        const due = await this.url_import_manager.due(now);
        let queued = 0;
        for (const source of due) {
            try {
                const { account_id, file_id } = source;
                await this.url_import_manager.update(account_id, file_id, {
                    next_sync_at: next_sync_at(source.schedule, now)
                });
                const file = await this.file_directory_svc.get_by_id(file_id);
                if (!file || file.deleted || file.account_id !== account_id) {
                    await this.url_import_manager.remove(account_id, file_id);
                    continue;
                }
                const account = await this.account_svc.get(account_id);
                if (!account || account.locked || file.locked || file.status === 'PENDING') {
                    continue;
                }
                await this.url_import_svc.queue_sync(account_id, file);
                this.web_file_prc_notify_svc.ws_pr_send_to_fe({
                    client_id: _c.HORIZON_PRC_WS_CLIENT_ID,
                    file_id,
                    account_id,
                    event: 'WEB_FILE_PROCESS_START'
                });
                queued++;
            } catch (ex) {
                logger.error(`URL sync for file ${source.file_id} not queued: ${ex.message}`);
            }
        }
        if (queued > 0) this.wake_file_processor();
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
        this.url_sync_processor.cancel(file_id);
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
        this.wake_file_processor();
    }

    // Runs one job at a time. Only start it through wake_file_processor (or its own
    // setTimeout below), which checks job_state, so two loops never run at once.
    async check_for_jobs() {
        // logger.debug(`${env.SERVER_NAME} finding latest job`);

        // Set before the first await: otherwise a second wake during get_latest_pending
        // would start another loop.
        this.job_manager.job_state = 'RUNNING';

        const job_events = [
            'FILE_UPLOAD',
            'COLUMN_UPDATE',
            URL_JOB_EVENTS.import,
            URL_JOB_EVENTS.sync
        ];

        let job;
        try {
            job = await this.job_manager.get_latest_pending(job_events);
        } catch (ex) {}

        if (job) {
            logger.debug(`processing ${job.event} wth id ${job.id}`);

            try {
                if (job.event === 'FILE_UPLOAD') {
                    await this.file_process(job);
                } else if (job.event === 'COLUMN_UPDATE') {
                    await this.column_update(job);
                } else if (job.event === URL_JOB_EVENTS.import) {
                    await this.url_import(job);
                } else if (job.event === URL_JOB_EVENTS.sync) {
                    await this.url_sync(job);
                }
            } catch (ex) {
                logger.error(`job ${job.id} failed: ${ex && ex.message}`);
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

    // Fetches a table's source URL (#144) into the temp file the CSV readers use
    private async fetch_url_source(source: UrlSource, file_path: string) {
        const res = await fetch_source(source.fetch_url);
        const csv = body_to_csv(res.content_type, res.url, res.body);
        await fs.promises.mkdir(path.dirname(file_path), { recursive: true });
        await fs.promises.writeFile(file_path, csv);
    }

    private async url_source_done(source: UrlSource, ex?: any) {
        const now = Date.now();
        const changes: Partial<UrlSource> = ex
            ? { last_status: 'ERROR', last_error: String((ex && ex.message) || ex).trim() }
            : { last_status: 'OK', last_error: null, last_synced_at: now };
        try {
            const row_coll = await this._collections.get_dg_row(source.account_id, source.file_id);
            changes.last_row_count = await row_coll.countDocuments();
            await this.url_import_manager.update(source.account_id, source.file_id, changes);
        } catch (err) {
            logger.error(`URL source of file ${source.file_id} not updated: ${err.message}`);
        }
    }

    // The first import of a table from a URL (#144): fetch it, then load it like a CSV upload.
    // A failure leaves the table in ERROR, as a failed upload does.
    async url_import(job) {
        const { id, account_id, file_id, file_name } = job;
        const file_path = `${env.HORIZON_FILE_SHARE}/temp/${file_name}`;
        const source = await this.url_import_manager.get(account_id, file_id);
        try {
            const account = await this.account_svc.get(account_id);
            const file = await this.file_directory_svc.get_by_id(file_id);
            if (!file) throw { message: 'Table not found' };
            if (job.restarts > _c.JOB_RESTART_LIMIT) {
                throw { message: 'Could not process file' };
            }
            if (!(await this.validate_file_for_processing(id, file))) return;
            if (!source) throw { message: 'The table has no source URL' };
            await this.fetch_url_source(source, file_path);
            await this.web_file_manager.delete_dg(account, file.id);
            await this.csv_processor.csv_to_data_grid(account, file_id, file_path);
            // The table first, then its source: a source that says OK has a usable table
            await this.web_file_process_complete(account_id, id, file_id);
            await this.url_source_done(source);
        } catch (ex) {
            if (!ex || ex.message !== 'File delete request') {
                await this.web_file_process_error(account_id, id, file_id, ex);
                if (source) await this.url_source_done(source, ex);
            }
        } finally {
            this.remove_file(file_path);
        }
    }

    // A re-sync of a table imported from a URL (#144). The table keeps working if it fails:
    // its rows stay as they were (everything is checked before anything is written) and the
    // error is kept on the source and sent to the app.
    async url_sync(job) {
        const { id, account_id, file_id, file_name } = job;
        const file_path = `${env.HORIZON_FILE_SHARE}/temp/${file_name}`;
        const source = await this.url_import_manager.get(account_id, file_id);
        try {
            const account = await this.account_svc.get(account_id);
            const file = await this.file_directory_svc.get_by_id(file_id);
            if (!file || file.deleted) {
                await this.job_manager.update(id, { status: 'ERROR', status_reason: 'Deleted' });
                return;
            }
            if (job.restarts > _c.JOB_RESTART_LIMIT) throw { message: 'Could not sync the table' };
            if (file.locked) throw { message: file.locked_reason || 'The table is locked' };
            if (!source) throw { message: 'The table has no source URL' };
            await this.fetch_url_source(source, file_path);
            const res = await this.url_sync_processor.sync(
                account,
                file_id,
                file_path,
                source,
                () => this.file_directory_svc.clear_links_to_table(account_id, file_id, false)
            );
            logger.info(
                `URL sync of file ${file_id}: ${res.rows} rows, ${res.inserted} added, ${res.updated} updated`
            );
            await this.web_file_process_complete(account_id, id, file_id);
            await this.url_source_done(source);
        } catch (ex) {
            if (ex && ex.message === 'File delete request') return;
            await this.file_directory_svc.update(file_id, { status: null, status_reason: null });
            await this.web_file_process_error(account_id, id, file_id, ex, {
                set_file_error: false
            });
            if (source) await this.url_source_done(source, ex);
        } finally {
            this.remove_file(file_path);
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
