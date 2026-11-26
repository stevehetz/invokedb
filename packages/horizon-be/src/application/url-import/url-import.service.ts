import {
    BadRequestException,
    ConflictException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { AccountService } from '../account/account.service';
import { WebFilePrcNotifyService } from '../web-file/web-file-prc-notify.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { JobManager } from '@app/core/job/job.manager';
import { UrlImportManager, UrlSource } from '@app/core/url-import/url-import.manager';
import { assert_public_host } from '@app/core/url-import/url-fetch';
import {
    UrlImportError,
    next_sync_at,
    parse_source_url,
    parse_sync_settings
} from '@app/core/url-import/url-import';
import { validate_file_dir_name, validate_file_dir_msg } from '@app/core/helpers/validators';
import _c from '@app/constants';
import { assert_room, assert_sync_schedule } from '@app/core/plan/plans';

export const URL_JOB_EVENTS = { import: 'URL_IMPORT', sync: 'URL_SYNC' };

// Tables imported from a URL (#144): create one, read or change its source, queue a re-sync.
// The fetching itself happens in the job processor (WebFilePrcService), which runs the same
// checks again on every address it connects to.
@Injectable()
export class UrlImportService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private tracking_manager: TrackingManager,
        private job_manager: JobManager,
        private web_file_prc_notify_svc: WebFilePrcNotifyService,
        private url_import_manager: UrlImportManager
    ) {}

    // A URL the server may fetch: its rules, then the addresses its host resolves to
    private async checked_url(input: unknown) {
        try {
            const source = parse_source_url(input);
            await assert_public_host(source.fetch_url);
            return source;
        } catch (ex) {
            if (ex instanceof UrlImportError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    private settings(body: any, current?: UrlSource) {
        try {
            return parse_sync_settings(body, current);
        } catch (ex) {
            if (ex instanceof UrlImportError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    private async account(acct_id: number) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        return account;
    }

    // What the app sees of a source
    view(source: UrlSource | null) {
        if (!source) return { source: null };
        const { account_id: _a, ...rest } = source;
        return { source: rest };
    }

    /** Body: `{ new_name, url, parent_id?, mode?, key_column?, schedule? }`. Answers the table id. */
    async create(acct_id: number, body: any) {
        const b = body && typeof body === 'object' ? body : {};
        const account = await this.account(acct_id);
        // Before any other check, so a read-only account (#184) is told why
        await this.tracking_manager.check_not_read_only(account);
        const name = b.new_name;
        if (typeof name !== 'string' || !validate_file_dir_name(name)) {
            throw new HttpException(validate_file_dir_msg(), HttpStatus.BAD_REQUEST);
        }
        const settings = this.settings(b);
        // The plan's URL sources and sync schedules (#183): 403 `plan_limit`, no table made
        assert_room(account, 'url_sources', await this.url_import_manager.count(acct_id));
        assert_sync_schedule(account, settings.schedule);
        const url = await this.checked_url(b.url);
        const parent_id =
            b.parent_id !== undefined && b.parent_id !== null ? Number(b.parent_id) : null;

        const no_file = true;
        const file = await this.file_directory_svc.create(
            acct_id,
            { name, parent_id, type: 'file', web_file_type: 'data-grid', status: 'PENDING' },
            no_file
        );
        const now = Date.now();
        try {
            await this.url_import_manager.create({
                file_id: file.id,
                account_id: acct_id,
                ...url,
                ...settings,
                created_at: now,
                next_sync_at: next_sync_at(settings.schedule, now),
                last_synced_at: null,
                last_status: 'PENDING',
                last_error: null,
                last_row_count: null
            });
            await this.queue_job(acct_id, file.id, URL_JOB_EVENTS.import);
        } catch (ex) {
            const account = await this.account_svc.get(acct_id);
            await this.file_directory_svc.batch_delete(account, { ids: [file.id] });
            throw ex;
        }
        this.web_file_prc_notify_svc.job_start(_c.HORIZON_BE_WS_CLIENT_ID, acct_id, file.id);
        return file.id;
    }

    private async owned_source(acct_id: number, file_id) {
        const file = await this.file_directory_svc.assert_owned(acct_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException();
        return { file, source: await this.url_import_manager.get(acct_id, file.id) };
    }

    async get(acct_id: number, file_id) {
        const { source } = await this.owned_source(acct_id, file_id);
        return this.view(source);
    }

    /** Body: any of `{ url, mode, key_column, schedule }`. */
    async update(acct_id: number, file_id, body: any) {
        const { file, source } = await this.owned_source(acct_id, file_id);
        if (!source) throw new NotFoundException('This table was not imported from a URL');
        const b = body && typeof body === 'object' ? body : {};
        const settings = this.settings(b, source);
        if (settings.schedule !== source.schedule) {
            assert_sync_schedule(await this.account_svc.get(acct_id), settings.schedule);
        }
        const changes: Partial<UrlSource> = { ...settings };
        if (b.url !== undefined && b.url !== source.url) {
            Object.assign(changes, await this.checked_url(b.url));
        }
        if (settings.schedule !== source.schedule || source.next_sync_at === null) {
            changes.next_sync_at = next_sync_at(settings.schedule, Date.now());
        }
        return this.view(await this.url_import_manager.update(acct_id, file.id, changes));
    }

    /** Fetches the source again and updates the table (a job). */
    async sync(acct_id: number, file_id) {
        const { file, source } = await this.owned_source(acct_id, file_id);
        if (!source) throw new NotFoundException('This table was not imported from a URL');
        const account = await this.account(acct_id);
        // A read-only account (#184) syncs nothing (the processor's check covers scheduled ones)
        await this.tracking_manager.check_not_read_only(account);
        await this.queue_sync(acct_id, file);
        this.web_file_prc_notify_svc.job_start(_c.HORIZON_BE_WS_CLIENT_ID, acct_id, file.id);
        return this.view(await this.url_import_manager.get(acct_id, file.id));
    }

    /**
     * Marks the table as updating and queues its sync job. Used by the route above and by the
     * scheduler; the caller tells the job processor and the app.
     */
    async queue_sync(acct_id: number, file) {
        if (file.status === 'PENDING') {
            throw new ConflictException('The table is already updating');
        }
        await this.file_directory_svc.update(file.id, { status: 'PENDING', status_reason: null });
        await this.url_import_manager.update(acct_id, file.id, { last_status: 'PENDING' });
        await this.queue_job(acct_id, file.id, URL_JOB_EVENTS.sync);
    }

    private async queue_job(acct_id: number, file_id: number, event: string) {
        await this.job_manager.create({
            account_id: acct_id,
            file_id,
            file_name: `acct-${acct_id}_url_${file_id}_${Date.now()}.csv`,
            status: 'PENDING',
            event
        });
    }
}
