import {
    ConflictException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { createWriteStream } from 'fs';
import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';
import env from '@app/env';
import _c from '@app/constants';
import logger from '@app/logger';
import { JobManager } from '@app/core/job/job.manager';
import { MongoDbCollections } from '@app/core/mongodb/collections';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { ViewManager } from '@app/core/view/view.manager';
import { WebhookManager } from '@app/core/webhook/webhook.manager';
import { AccountExportManager } from '@app/core/account-export/account-export.manager';
import {
    EXPORT_JOB_EVENT,
    EXPORT_LIMITS,
    ExportTablePath,
    csv_chunks,
    download_name,
    export_columns,
    export_file_name,
    export_view,
    is_active,
    is_downloadable,
    json_chunks,
    manifest,
    new_export,
    table_paths,
    view_settings,
    webhook_settings
} from '@app/core/account-export/account-export';
import { ZipWriter } from '@app/core/account-export/zip-writer';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { WebFilePrcNotifyService } from '../web-file/web-file-prc-notify.service';

// How often the processor removes zips whose link has stopped working
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export function exports_dir() {
    return path.join(env.HORIZON_FILE_SHARE, 'exports');
}

// Data export of an account (#215): the app asks for one, the job processor writes the zip to
// the file share, and the app downloads it with the account's own session for 24 hours.
@Injectable()
export class AccountExportService {
    constructor(
        private export_manager: AccountExportManager,
        private job_manager: JobManager,
        private file_directory_svc: FileDirectoryService,
        private web_file_manager: WebFileManager,
        private view_manager: ViewManager,
        private webhook_manager: WebhookManager,
        private _collections: MongoDbCollections,
        private notify_svc: WebFilePrcNotifyService
    ) {
        if (env.IS_HORIZON_PRC) {
            setInterval(() => {
                this.remove_expired(Date.now()).catch(ex =>
                    logger.error(`Export cleanup failed: ${ex && ex.message}`)
                );
            }, CLEANUP_INTERVAL_MS);
        }
    }

    /** The account's newest export (null when there's none). */
    async status(account_id: number) {
        const now = Date.now();
        return { export: export_view(await this.export_manager.latest(account_id), now) };
    }

    /** Queues a new export. One at a time, and at most a few a day. */
    async request(account_id: number) {
        if (!account_id) throw new NotFoundException();
        const now = Date.now();
        const latest = await this.export_manager.latest(account_id);
        if (is_active(latest)) {
            throw new ConflictException('An export is already being prepared');
        }
        const recent = await this.export_manager.count_since(
            account_id,
            now - EXPORT_LIMITS.per_ms
        );
        if (recent >= EXPORT_LIMITS.max_per_window) {
            throw new HttpException(
                `You can export your data ${EXPORT_LIMITS.max_per_window} times a day. Try again tomorrow.`,
                HttpStatus.TOO_MANY_REQUESTS
            );
        }
        const record = new_export(account_id, now);
        await this.export_manager.create(record);
        await this.job_manager.create({
            account_id,
            file_id: null,
            file_name: export_file_name(record.id),
            event: EXPORT_JOB_EVENT,
            data: { export_id: record.id },
            status: 'PENDING',
            restarts: 0
        });
        this.notify_svc.wake_processor(_c.HORIZON_BE_WS_CLIENT_ID);
        return { export: export_view(record, now) };
    }

    /** The zip to send: only the account's own export, only while its link works. */
    async download(account_id: number, id: string) {
        const record = await this.export_manager.get(account_id, id);
        if (!record) throw new NotFoundException();
        if (!is_downloadable(record, Date.now())) {
            throw new HttpException('This export has expired', HttpStatus.GONE);
        }
        const file_path = path.join(exports_dir(), export_file_name(record.id));
        try {
            await fs.promises.access(file_path);
        } catch (ex) {
            throw new HttpException('This export has expired', HttpStatus.GONE);
        }
        return { file_path, name: download_name(record.created_at) };
    }

    // The processor's side

    /** Runs an ACCOUNT_EXPORT job: writes the zip, then marks the export ready (or failed). */
    async run(job: any) {
        const { id: job_id, account_id } = job;
        const export_id = job.data && job.data.export_id;
        const record = await this.export_manager.get(account_id, export_id);
        if (!record) {
            await this.job_manager.update(job_id, { status: 'ERROR', status_reason: 'Not found' });
            return;
        }
        const dir = exports_dir();
        const final_path = path.join(dir, export_file_name(record.id));
        const part_path = `${final_path}.part`;
        try {
            if (job.restarts > _c.JOB_RESTART_LIMIT) {
                throw new Error('Could not prepare the export');
            }
            await this.export_manager.update(account_id, record.id, {
                status: 'running',
                started_at: Date.now()
            });
            await fs.promises.mkdir(dir, { recursive: true });
            const totals = await this.write_zip(account_id, part_path);
            await fs.promises.rename(part_path, final_path);
            const finished_at = Date.now();
            await this.export_manager.update(account_id, record.id, {
                status: 'ready',
                finished_at,
                expires_at: finished_at + EXPORT_LIMITS.keep_ms,
                ...totals,
                error: null
            });
            await this.job_manager.update(job_id, { status: 'COMPLETE' });
            logger.info(
                `Export ${record.id} of account ${account_id}: ${totals.tables} tables, ${totals.rows} rows, ${totals.size} bytes`
            );
        } catch (ex) {
            const message = String((ex && ex.message) || ex).trim();
            logger.error(`Export ${record.id} of account ${account_id} failed: ${message}`);
            await fs.promises.rm(part_path, { force: true }).catch(() => {});
            await this.export_manager.update(account_id, record.id, {
                status: 'error',
                finished_at: Date.now(),
                error: 'The export could not be prepared. Please try again.'
            });
            await this.job_manager.update(job_id, { status: 'ERROR', status_reason: message });
        }
    }

    /** Writes the account's zip to `file_path`. */
    async write_zip(account_id: number, file_path: string) {
        const out = createWriteStream(file_path);
        const closed = new Promise<void>((resolve, reject) => {
            out.on('close', resolve);
            out.on('error', reject);
        });
        try {
            const totals = await this.write_entries(account_id, out);
            out.end();
            await closed;
            return totals;
        } catch (ex) {
            out.destroy();
            await closed.catch(() => {});
            throw ex;
        }
    }

    /** Every entry of the zip, into `out` (which it doesn't end). */
    async write_entries(account_id: number, out: Writable) {
        const now = Date.now();
        const zip = new ZipWriter(out, new Date(now));
        const entries = (await this.file_directory_svc.get_by_account_id(account_id)) || [];
        const paths = table_paths(
            entries.map(e => ({
                id: e.id,
                name: e.name,
                type: e.type,
                parent_id: e.parent_id ?? null
            }))
        );
        const table_names = new Map(paths.map(t => [t.id, t.name]));

        const written: Array<ExportTablePath & { rows: number; columns: number }> = [];
        let total_rows = 0;
        for (const table of paths) {
            const cols = await this.web_file_manager.get_columns(account_id, table.id);
            const columns = export_columns(cols, table_names);
            let rows = 0;
            const counted = async function* (source: AsyncIterable<any>) {
                for await (const row of source) {
                    rows++;
                    yield row;
                }
            };
            await zip.add(
                `${table.path}.csv`,
                csv_chunks(columns, counted(await this.rows(account_id, table.id)))
            );
            await zip.add(
                `${table.path}.json`,
                json_chunks(table, columns, await this.rows(account_id, table.id))
            );
            total_rows += rows;
            written.push({ ...table, rows, columns: columns.length });
        }

        const views = [];
        for (const table of paths) {
            const list = await this.view_manager.list(account_id, table.id);
            views.push(...list.map(v => view_settings(v, table_names)));
        }
        await zip.add('views.json', pretty(views));

        const hooks = await this.webhook_manager.list(account_id);
        await zip.add('webhooks.json', pretty(hooks.map(h => webhook_settings(h, table_names))));

        await zip.add('manifest.json', pretty(manifest(now, written)));
        await zip.finish();
        return { tables: written.length, rows: total_rows, size: zip.bytes };
    }

    /** A table's rows, read a batch at a time, in the order they were added. */
    private async rows(account_id: number, table_id: number): Promise<AsyncIterable<any>> {
        const coll = await this._collections.get_dg_row(account_id, table_id);
        return coll.find({}).sort({ _id: 1 }).batchSize(EXPORT_LIMITS.batch_size);
    }

    /** Removes the zips whose link has stopped working, and marks them expired. */
    async remove_expired(now: number) {
        const expired = await this.export_manager.expired(now);
        for (const e of expired) {
            const file_path = path.join(exports_dir(), export_file_name(e.id));
            await fs.promises.rm(file_path, { force: true });
            await this.export_manager.update(e.account_id, e.id, { status: 'expired' });
        }
        return expired.length;
    }
}

function pretty(value: unknown) {
    return JSON.stringify(value, null, 2) + '\n';
}
