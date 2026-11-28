import {
    Injectable,
    HttpException,
    HttpStatus,
    NotFoundException,
    UnauthorizedException
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { FileDirectory } from '@app/core/file-directory/file-directory.entity';
import { FileDirectoryGetDto } from './dto/file-directory-get.dto';
import { AccountService } from '../account/account.service';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { plainToClass } from 'class-transformer';
import { WebFilePrcNotifyService } from '../web-file/web-file-prc-notify.service';
import { UrlImportManager } from '@app/core/url-import/url-import.manager';
import { WebhookManager } from '@app/core/webhook/webhook.manager';
import { ViewManager } from '@app/core/view/view.manager';
import { AiColumnManager } from '@app/core/ai-column/ai-column.manager';
import { OnboardingManager } from '@app/core/onboarding/onboarding.manager';
import {
    assert_verified,
    creating_needs_verified_email
} from '@app/core/email-verification/email-verification';
import { build_schema_diagram } from '@app/core/schema-diagram/schema-diagram';
import { AuditService } from '../audit/audit.service';
import { AuditActor, table_change } from '@app/core/audit/audit';
import _c from '@app/constants';
import logger from '@app/logger';

/**
 * The items to delete for a batch (#357): the asked ones plus every live item inside an asked
 * folder, at any depth, contents before their folder and each item once. `live` is the
 * account's items that aren't deleted.
 */
export function with_folder_contents<T extends { id: number; parent_id?: number | null }>(
    asked: T[],
    live: T[]
): T[] {
    const out: T[] = [];
    const seen = new Set<number>();
    const visit = (item: T, depth: number) => {
        if (seen.has(item.id) || depth > 50) return;
        seen.add(item.id);
        for (const child of live.filter(f => f.parent_id === item.id)) visit(child, depth + 1);
        out.push(item);
    };
    for (const item of asked) visit(item, 0);
    return out;
}

@Injectable()
export class FileDirectoryService {
    constructor(
        @InjectRepository(FileDirectory)
        private readonly file_directory_repository: Repository<FileDirectory>,
        private account_service: AccountService,
        private web_file_manager: WebFileManager,
        private tracking_manager: TrackingManager,
        private web_file_prc_notify_svc: WebFilePrcNotifyService,
        private url_import_manager: UrlImportManager,
        private webhook_manager: WebhookManager,
        private view_manager: ViewManager,
        private onboarding_manager: OnboardingManager,
        private audit_svc: AuditService,
        private ai_column_manager: AiColumnManager
    ) {}

    async get_by_id(file_directory_id: number) {
        return await this.file_directory_repository.findOneBy({ id: file_directory_id });
    }

    async get_by_account_id(account_id: number) {
        return await this.file_directory_repository.findBy({ account_id, deleted: false });
    }

    /** The account's tables, their columns and the links between them, laid out (#208). */
    async schema_diagram(account_id: number) {
        const files = (await this.get_by_account_id(account_id)) || [];
        const input = [];
        for (const table of files.filter(f => f.type === 'file')) {
            const columns = await this.web_file_manager.get_columns(account_id, table.id);
            input.push({ id: table.id, name: table.name, columns });
        }
        return build_schema_diagram(input);
    }

    async get_all(account_id) {
        const file_directories = await this.file_directory_repository.find({
            where: { account_id, deleted: false },
            order: {
                type: 'ASC',
                name: 'ASC'
            }
        });

        const file_directory_gets: FileDirectoryGetDto[] = plainToClass(
            FileDirectoryGetDto,
            file_directories
        );

        return file_directory_gets;
    }

    /** Throws unless the table or folder exists and belongs to the account. */
    async assert_owned(account_id: number, file_directory_id) {
        const id = Number(file_directory_id);
        if (!account_id || !Number.isInteger(id)) throw new NotFoundException();
        const file_directory = await this.get_by_id(id);
        if (!file_directory) throw new NotFoundException();
        if (file_directory.account_id !== account_id) throw new UnauthorizedException();
        return file_directory;
    }

    /** A parent must be one of the account's own folders (null means the top level). */
    async assert_valid_parent(account_id: number, parent_id) {
        if (parent_id === null || parent_id === undefined) return;
        const parent = await this.assert_owned(account_id, parent_id);
        if (parent.type !== 'dir' || parent.deleted) {
            throw new HttpException('Parent is not a folder', HttpStatus.BAD_REQUEST);
        }
    }

    async validate(data) {
        if (!data.account_id)
            throw new HttpException('account_id was not passed in', HttpStatus.NOT_FOUND);

        if (!data.name) throw new HttpException('name was not passed in', HttpStatus.NOT_FOUND);

        if (!data.type) throw new HttpException('type was not passed in', HttpStatus.NOT_FOUND);

        if (data.name.length > 150)
            throw new HttpException(
                'Name can not be longer that 150 characters',
                HttpStatus.NOT_FOUND
            );

        await this.assert_valid_parent(data.account_id, data.parent_id);

        if (await this.same_name_type_and_folder_level(data))
            throw new HttpException('Name in use', HttpStatus.NOT_FOUND);
    }

    async same_name_type_and_folder_level(data) {
        const file_directories = await this.get_all(data.account_id);
        let same = false;
        data.parent_id = data.parent_id || null;
        file_directories.some(file_dir => {
            if (
                data.parent_id === file_dir.parent_id &&
                data.type === file_dir.type &&
                data.name.toLowerCase() === file_dir.name.toLowerCase()
            ) {
                same = true;

                // break out of the loop
                return true;
            }
        });
        return same;
    }

    /**
     * `acct_id` is the caller's account; any `account_id` in `data` is overwritten with it.
     * `actor`: who the audit log says made the table, when not the account's user (an API key).
     */
    async create(acct_id, data, no_file, actor?: AuditActor) {
        data.account_id = acct_id;
        const account = await this.account_service.get(acct_id);
        // Every way of making a table comes through here (new, upload, template, URL import)
        if (creating_needs_verified_email(data)) assert_verified(account);
        // Holds a place under the table limit until the table is saved, so parallel creates
        // can't pass it together (#182). Folders don't count against it (#237).
        const is_table = data.type !== 'dir';
        const release = is_table
            ? await this.tracking_manager.add_table(account)
            : async () => undefined;
        try {
            await this.validate(data);
            data.deleted = false;
            const create_dto = data;
            const res = (await this.file_directory_repository.save(create_dto)) as any;
            if (!no_file) {
                await this.web_file_manager.create_new(acct_id, res.id, data.web_file_type);
            }
            // The funnel's "created a table" step (#169)
            if (data.type !== 'dir') await this.onboarding_manager.record_table_created(acct_id);
            if (data.type === 'file') {
                await this.audit_svc.record(
                    account,
                    res.id,
                    [{ action: 'table.created', ...table_change('table.created', res.name) }],
                    { table_name: res.name, actor }
                );
            }
            return res;
        } finally {
            await release();
        }
    }

    /** Internal: no ownership check. Routes must use `update_owned`. */
    async update(file_directory_id, data) {
        const update_dto = data as any;
        await this.file_directory_repository.update(file_directory_id, update_dto);
        return await this.get_by_id(file_directory_id);
    }

    /** Rename or move one of the account's own tables or folders. */
    async update_owned(account_id: number, file_directory_id, data) {
        const file_directory = await this.assert_owned(account_id, file_directory_id);
        const changes: any = {};
        if (data.name !== undefined) changes.name = data.name;
        if (data.parent_id !== undefined) {
            changes.parent_id = data.parent_id;
            await this.assert_valid_parent(account_id, data.parent_id);
            // Walk up from the new parent: moving a folder into itself or its own subfolder
            // would make a cycle.
            let ancestor_id = data.parent_id;
            while (ancestor_id !== null && ancestor_id !== undefined) {
                if (ancestor_id === file_directory.id) {
                    throw new HttpException(
                        'A folder can not be moved into itself',
                        HttpStatus.BAD_REQUEST
                    );
                }
                const ancestor = await this.get_by_id(ancestor_id);
                ancestor_id = ancestor ? ancestor.parent_id : null;
            }
        }
        if (Object.keys(changes).length === 0) return file_directory;
        const updated = await this.update(file_directory.id, changes);
        if (
            file_directory.type === 'file' &&
            updated &&
            changes.name !== undefined &&
            updated.name !== file_directory.name
        ) {
            const change = table_change('table.renamed', updated.name, file_directory.name);
            await this.audit_svc.record(
                await this.account_service.get(account_id),
                file_directory.id,
                [{ action: 'table.renamed', ...change }],
                { table_name: updated.name }
            );
        }
        return updated;
    }

    /** Marks the account's own tables and folders deleted. Rejects the whole batch if any id isn't theirs. */
    async batch_delete(account, data) {
        const ids = Array.isArray(data && data.ids) ? data.ids.map(Number) : [];
        if (ids.length === 0) return 'done';
        if (!ids.every(Number.isInteger)) {
            throw new HttpException('ids must be integers', HttpStatus.BAD_REQUEST);
        }

        const asked = await this.file_directory_repository.findBy({ id: In(ids) });
        if (asked.length !== new Set(ids).size) throw new NotFoundException();
        if (asked.some(f => f.account_id !== account.id)) {
            throw new UnauthorizedException();
        }

        // A folder goes with what's in it (#357): its live tables (and any folders inside it)
        // are deleted first, each through the same path as a table deleted on its own
        const file_directories = asked.some(f => f.type === 'dir')
            ? with_folder_contents(asked, (await this.get_by_account_id(account.id)) || [])
            : asked;

        for (const file_directory of file_directories) {
            this.web_file_prc_notify_svc.file_delete_request(
                _c.HORIZON_BE_WS_CLIENT_ID,
                account.id,
                file_directory.id
            );
            await this.file_directory_repository.update(file_directory.id, { deleted: true });
            if (file_directory.type === 'file') {
                if (!file_directory.deleted) {
                    const change = table_change('table.deleted', file_directory.name);
                    await this.audit_svc.record(
                        account,
                        file_directory.id,
                        [{ action: 'table.deleted', ...change }],
                        { table_name: file_directory.name }
                    );
                }
                try {
                    await this.web_file_manager.delete_dg(account, file_directory.id);
                } catch (ex) {
                    logger.error(`delete_dg failed for file ${file_directory.id}: ${ex.message}`);
                }
                try {
                    await this.clear_links_to_table(account.id, file_directory.id, true);
                } catch (ex) {
                    logger.error(`Links to file ${file_directory.id} not cleared: ${ex.message}`);
                }
                try {
                    await this.url_import_manager.remove(account.id, file_directory.id);
                } catch (ex) {
                    logger.error(
                        `URL source of file ${file_directory.id} not removed: ${ex.message}`
                    );
                }
                try {
                    await this.webhook_manager.remove_for_table(account.id, file_directory.id);
                } catch (ex) {
                    logger.error(
                        `Webhooks of file ${file_directory.id} not removed: ${ex.message}`
                    );
                }
                try {
                    await this.view_manager.remove_for_table(account.id, file_directory.id);
                } catch (ex) {
                    logger.error(`Views of file ${file_directory.id} not removed: ${ex.message}`);
                }
                try {
                    await this.ai_column_manager.remove_table(account.id, file_directory.id);
                } catch (ex) {
                    logger.error(
                        `AI columns of file ${file_directory.id} not removed: ${ex.message}`
                    );
                }
            }
        }
        await this.tracking_manager.deleted_table(account);
        return 'done';
    }

    /**
     * Every row of this table is gone (#175): empties the link cells of the account's other
     * tables that point at it. `deleted` (the table itself was deleted) also turns those
     * columns into string columns; after a replace re-sync they stay links.
     */
    async clear_links_to_table(account_id: number, file_id: number, deleted: boolean) {
        const tables = (await this.get_by_account_id(account_id)) || [];
        for (const table of tables.filter(t => t.type === 'file')) {
            if (deleted && table.id === file_id) continue;
            await this.web_file_manager.clear_all_links(account_id, table.id, file_id, deleted);
        }
    }
}
