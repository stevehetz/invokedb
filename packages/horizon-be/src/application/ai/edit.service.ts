import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { AccountService } from '../account/account.service';
import { WebFileService } from '../web-file/web-file.service';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { QueryColumn } from '@app/core/web-file/row-query';
import { AskError, ask_columns } from '@app/core/ai/ask';
import {
    EDIT_MAX_ROWS,
    EditSpec,
    EditedRow,
    edit_row,
    parse_apply_body,
    row_unchanged_since
} from '@app/core/ai/edit';

export interface EditPreview {
    summary: string;
    // The columns the edit changes
    columns: { field: string; name: string; type: string }[];
    // The rows it changes, each with its changed cells before and after (keyed by field)
    rows: EditedRow[];
    // Rows matching the filters, and the most one edit changes
    matching: number;
    limit: number;
    capped: boolean;
}

// Editing data with natural language (#204). Ask AI's model proposes an edit (core/ai/edit.ts);
// `preview` works it out on the rows, writing nothing, and `apply` writes what the user
// confirmed through the ordinary row update (locks, webhooks), only to rows that still hold the
// values the preview showed. Undo is `apply` with before and after swapped. Applying calls no
// model, so it costs no question.
@Injectable()
export class EditService {
    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private web_file_manager: WebFileManager,
        private web_file_svc: WebFileService
    ) {}

    // Rows in API form keyed by field: dates as the grid shows them, missing cells null
    rows_by_field(docs: any[], columns: QueryColumn[]) {
        return docs.map(doc => {
            const row: any = { _id: doc._id };
            columns.forEach(c => {
                const value = doc[c.field] === undefined ? null : doc[c.field];
                row[c.field] =
                    c.type === 'date' && value
                        ? this.web_file_manager.format_date_field(value)
                        : value;
            });
            return row;
        });
    }

    /** The edit worked out on the table's rows (already checked as the account's); no writes. */
    async preview(
        acct_id: number,
        file_id: number,
        columns: QueryColumn[],
        spec: EditSpec
    ): Promise<EditPreview> {
        const res = await this.web_file_manager.query_rows(acct_id, file_id, spec.query);
        const docs = res.docs.slice(0, EDIT_MAX_ROWS);
        const matching = await this.web_file_manager.count_rows(acct_id, file_id, spec.count_query);
        const rows = this.rows_by_field(docs, columns)
            .map(row => edit_row(spec.changes, row))
            .filter(Boolean);
        return {
            summary: spec.summary,
            columns: spec.changes.map(c => ({
                field: c.column.field,
                name: c.column.name,
                type: c.column.type
            })),
            rows,
            matching,
            limit: EDIT_MAX_ROWS,
            capped: matching > EDIT_MAX_ROWS
        };
    }

    /**
     * Applies an edit the user confirmed, or undoes one. Body: `{ rows: [{ _id, before, after
     * }] }` (cells keyed by field). A row is written only if it still holds `before`; answers
     * `{ updated: [ids], skipped: [ids] }` (skipped: changed since, or deleted).
     */
    async apply(acct_id: number, file_id: unknown, body: unknown) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        if (file_id === null || file_id === undefined || file_id === '') {
            throw new BadRequestException('Pick a table');
        }
        const file = await this.file_directory_svc.assert_owned(acct_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException('Table not found');
        const columns = ask_columns(await this.web_file_manager.get_columns(acct_id, file.id));
        let rows;
        try {
            rows = parse_apply_body(body, columns);
        } catch (ex) {
            if (ex instanceof AskError) throw new BadRequestException(ex.message);
            throw ex;
        }
        const docs = await this.web_file_manager.rows_by_ids(
            acct_id,
            file.id,
            rows.map(r => r._id)
        );
        const updates = [];
        const skipped: string[] = [];
        rows.forEach(r => {
            const doc = docs.get(r._id);
            const current = doc ? this.rows_by_field([doc], columns)[0] : null;
            if (!current || !row_unchanged_since(current, r.before, columns)) {
                skipped.push(r._id);
                return;
            }
            updates.push({ _id: r._id, ...r.after });
        });
        const updated = updates.map(u => u._id);
        if (updates.length > 0) {
            await this.web_file_svc.batch_update_internal(
                account,
                file.id,
                'data_grid_row',
                updates
            );
        }
        return { updated, skipped };
    }
}
