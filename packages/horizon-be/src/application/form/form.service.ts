import {
    BadRequestException,
    ForbiddenException,
    GoneException,
    HttpException,
    HttpStatus,
    Injectable,
    NotFoundException
} from '@nestjs/common';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { AccountService } from '../account/account.service';
import { WebFileService } from '../web-file/web-file.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { Form, FormManager } from '@app/core/form/form.manager';
import {
    FORM_LIMITS,
    FormColumn,
    FormError,
    FormSettings,
    form_columns,
    new_form_id,
    parse_form_settings,
    parse_submission,
    public_form
} from '@app/core/form/form';
import logger from '@app/logger';
import { assert_room } from '@app/core/plan/plans';
import { form_actor } from '@app/core/audit/audit';

export const FORM_NOT_FOUND = "This form doesn't exist or has been deleted.";
export const FORM_CLOSED = 'This form is closed.';
export const FORM_UNAVAILABLE = "This form can't take responses right now.";

// Shareable forms that add rows to a table (#145): the owner's settings from the app, and the
// public link's view and submissions. A submission is a row created like one from the app
// (the row limit of the account's plan, the account and table locks, webhooks). The controller
// rate-limits the submissions (FormRateLimit).
@Injectable()
export class FormService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private web_file_svc: WebFileService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private form_manager: FormManager
    ) {}

    // Overridden by the unit tests
    now() {
        return Date.now();
    }

    private checked<T>(fn: () => T): T {
        try {
            return fn();
        } catch (ex) {
            if (ex instanceof FormError) {
                throw new BadRequestException({ message: ex.message, errors: ex.errors });
            }
            throw ex;
        }
    }

    // A table of the account's that hasn't been deleted
    private async owned_table(acct_id: number, file_id: unknown) {
        if (file_id === null || file_id === undefined || file_id === '') {
            throw new BadRequestException('Pick a table');
        }
        const file = await this.file_directory_svc.assert_owned(acct_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException('Table not found');
        return file;
    }

    private async columns(acct_id: number, file_id: number): Promise<FormColumn[]> {
        const cols = await this.web_file_manager.get_all(acct_id, file_id, 'data_grid_column');
        return form_columns((cols && cols.data) || []);
    }

    private async owned(acct_id: number, id: string) {
        const form = await this.form_manager.get(acct_id, id);
        if (!form) throw new NotFoundException('Form not found');
        return form;
    }

    // What the app sees of a form (the account's own)
    view(form: Form) {
        const { account_id: _a, ...rest } = form;
        return rest;
    }

    /** The account's forms; with a table id, that table's, and the columns a form can ask. */
    async list(acct_id: number, table?: unknown) {
        let file_id: number | undefined;
        let columns: FormColumn[] | undefined;
        if (table !== undefined && table !== null && table !== '') {
            file_id = (await this.owned_table(acct_id, table)).id;
            columns = await this.columns(acct_id, file_id);
        }
        const forms = await this.form_manager.list(acct_id, file_id);
        return { forms: forms.map(f => this.view(f)), columns, limits: FORM_LIMITS };
    }

    async get(acct_id: number, id: string) {
        return this.view(await this.owned(acct_id, id));
    }

    /** Body: `{ file_id, title, fields: [{ field, label?, required?, help? }], ... }`. */
    async create(acct_id: number, body: any) {
        const b = body && typeof body === 'object' ? body : {};
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        // No new forms on a read-only account (#184)
        await this.tracking_manager.check_not_read_only(account);
        const file = await this.owned_table(acct_id, b.file_id);
        const columns = await this.columns(acct_id, file.id);
        const settings = this.checked(() => parse_form_settings(b, columns)) as FormSettings;
        // The plan's forms (#183): 403 `plan_limit`
        assert_room(account, 'forms', await this.form_manager.count(acct_id));
        const now = this.now();
        const form = await this.form_manager.create({
            ...settings,
            id: new_form_id(),
            account_id: acct_id,
            file_id: file.id,
            created_at: now,
            updated_at: now,
            submissions: 0,
            last_submission_at: null
        });
        return this.view(form);
    }

    /** Body: any of the settings; `{ open: false }` closes the form. */
    async update(acct_id: number, id: string, body: any) {
        const form = await this.owned(acct_id, id);
        if (body && typeof body === 'object' && body.file_id !== undefined) {
            if (Number(body.file_id) !== form.file_id) {
                throw new BadRequestException("A form's table can't be changed");
            }
        }
        const file = await this.owned_table(acct_id, form.file_id);
        const columns = await this.columns(acct_id, file.id);
        const changes = this.checked(() => parse_form_settings(body, columns, form));
        if (Object.keys(changes).length === 0) return this.view(form);
        return this.view(await this.form_manager.update(acct_id, form.id, changes));
    }

    async remove(acct_id: number, id: string) {
        const form = await this.owned(acct_id, id);
        await this.form_manager.remove(acct_id, form.id);
        return { deleted: form.id };
    }

    // A form its link may show: it exists, its table is still there and still the account's
    private async live_form(id: string) {
        const form = await this.form_manager.get_public(id);
        if (!form) throw new NotFoundException(FORM_NOT_FOUND);
        const file = await this.file_directory_svc.get_by_id(form.file_id);
        if (!file || file.deleted || file.type !== 'file' || file.account_id !== form.account_id) {
            throw new NotFoundException(FORM_NOT_FOUND);
        }
        if (!form.open) throw new GoneException(FORM_CLOSED);
        return form;
    }

    /** The public link's form: its questions and their types. */
    async public_view(id: string) {
        const form = await this.live_form(id);
        const columns = await this.columns(form.account_id, form.file_id);
        return public_form(form, columns);
    }

    /**
     * A submission from the public link: `{ values: { <key>: answer }, website: '' }`. Answers
     * `{ ok, thank_you, redirect_url }`. A filled honeypot gets the same answer, but no row.
     */
    async submit(id: string, body: any) {
        const form = await this.live_form(id);
        const columns = await this.columns(form.account_id, form.file_id);
        const submission = this.checked(() => parse_submission(body, form, columns));
        const done = {
            ok: true,
            thank_you: form.thank_you,
            redirect_url: form.redirect_url
        };
        if (submission.spam) return done;

        const account = await this.account_svc.get(form.account_id);
        if (!account) throw new NotFoundException(FORM_NOT_FOUND);
        try {
            // The account and table locks and the plan's row limit, then the webhooks (#140);
            // the audit log (#217) says the form added the row
            await this.web_file_svc.batch_create_internal(
                account,
                form.file_id,
                'data_grid_row',
                [submission.row],
                form_actor(form.id, form.title)
            );
        } catch (ex) {
            if (ex instanceof HttpException && ex.getStatus() === HttpStatus.FORBIDDEN) {
                // The owner's plan or lock isn't the visitor's business
                logger.info(`Form ${form.id} refused a submission: ${ex.message}`);
                throw new ForbiddenException(FORM_UNAVAILABLE);
            }
            throw ex;
        }
        try {
            await this.form_manager.submitted(form, this.now());
        } catch (ex) {
            logger.error(`Submission count of form ${form.id} not updated: ${ex && ex.message}`);
        }
        return done;
    }
}
