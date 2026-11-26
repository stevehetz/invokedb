import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { FileDirectoryService } from '../file-directory/file-directory.service';
import { AccountService } from '../account/account.service';
import { WebFilePrcNotifyService } from '../web-file/web-file-prc-notify.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { WebFileManager } from '@app/core/web-file/web-file.manager';
import { MongoDbCollections } from '@app/core/mongodb/collections';
import { AiClient, AiModelError } from '@app/core/ai/ai-client';
import { AiUsageManager } from '@app/core/ai/ai-usage.manager';
import { AiSpend } from '@app/core/ai/ai-spend';
import { ai_allowance, usage_month } from '@app/core/ai/ai-plan';
import { AiColumn, AiColumnManager } from '@app/core/ai-column/ai-column.manager';
import {
    AI_COLUMN_LIMITS,
    AI_COLUMN_SYSTEM,
    AiColumnError,
    AiColumnType,
    ROW_STATE_KEY,
    STOP_NOTES,
    StopReason,
    cell_hash,
    check_answer,
    chunks,
    column_max_tokens,
    column_prompt,
    column_schema,
    column_type,
    has_inputs,
    is_stale,
    parse_ai_column,
    row_inputs,
    settings_hash,
    stored_value
} from '@app/core/ai-column/ai-column';
import { LINK_TYPE } from '@app/core/web-file/link';
import env from '@app/env';
import _c from '@app/constants';
import logger from '@app/logger';

// How often the processor looks for AI columns with cells to compute
const PROCESSOR_INTERVAL_MS = 5000;

// A row that needs its cell computed, and the hash it will be stored with
interface Todo {
    doc: any;
    hash: string;
}

// What the routes answer for an AI column
function public_column(c: AiColumn) {
    return {
        field: c.field,
        prompt: c.prompt,
        inputs: c.inputs,
        auto: !!c.auto,
        state: c.state,
        stopped_reason: c.stopped_reason || null,
        note: c.stopped_reason ? STOP_NOTES[c.stopped_reason] || null : null,
        computed: c.computed || 0,
        filled_at: c.filled_at || null,
        updated_at: c.updated_at
    };
}

const live = (c: any) => c && !c.deleted && typeof c.headerName === 'string' && c.headerName !== '';

// AI columns (#205): a column whose cells the model fills from a prompt over other columns of
// the row (core/ai-column/ai-column.ts). The routes save the settings and, once the owner
// confirms the number of AI rows it will use, start filling; the processor role then computes
// every out-of-date cell in the background, and later the cells of rows whose inputs change.
// Every computed cell is one AI row of the month's allowance and its call is charged to the
// dollar budget (AiSpend); when either runs out the column stops filling, the cells left get a
// note, and nothing fails.
@Injectable()
export class AiColumnService {
    private running = false;

    constructor(
        private file_directory_svc: FileDirectoryService,
        private account_svc: AccountService,
        private notify_svc: WebFilePrcNotifyService,
        private tracking_manager: TrackingManager,
        private web_file_manager: WebFileManager,
        private _collections: MongoDbCollections,
        private ai_client: AiClient,
        private ai_usage: AiUsageManager,
        private ai_spend: AiSpend,
        private ai_columns: AiColumnManager
    ) {
        if (env.IS_HORIZON_PRC) {
            setInterval(() => this.tick(), PROCESSOR_INTERVAL_MS);
        }
    }

    // Overridden by the unit tests
    now() {
        return Date.now();
    }

    private checked<T>(fn: () => T): T {
        try {
            return fn();
        } catch (ex) {
            if (ex instanceof AiColumnError) throw new BadRequestException(ex.message);
            throw ex;
        }
    }

    /** The caller's table (404 for a folder or a deleted table, 401 for another account's). */
    private async owned_table(account_id: number, file_id: unknown) {
        if (file_id === null || file_id === undefined || file_id === '') {
            throw new BadRequestException('Pick a table');
        }
        const file = await this.file_directory_svc.assert_owned(account_id, file_id);
        if (file.type !== 'file' || file.deleted) throw new NotFoundException('Table not found');
        return file;
    }

    private async column(account_id: number, file_id: number, field: unknown) {
        const col =
            typeof field === 'string'
                ? await this.ai_columns.get(account_id, file_id, field)
                : null;
        if (!col) throw new NotFoundException('AI column not found');
        return col;
    }

    /** `{ columns, limits }`: the table's AI columns. */
    async list(account_id: number, file_id: unknown) {
        const file = await this.owned_table(account_id, file_id);
        const cols = await this.ai_columns.list(account_id, file.id);
        return {
            columns: cols.map(public_column),
            limits: {
                max_prompt_length: AI_COLUMN_LIMITS.max_prompt_length,
                max_inputs: AI_COLUMN_LIMITS.max_inputs,
                max_per_table: AI_COLUMN_LIMITS.max_per_table
            }
        };
    }

    /**
     * Body: `{ table, field, prompt, inputs }`. Makes the column an AI column, or changes its
     * settings; nothing is computed until the owner fills it (changed settings need a new fill).
     */
    async save(account_id: number, body: any) {
        const b = body && typeof body === 'object' ? body : {};
        const account = await this.account_svc.get(account_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.check_not_read_only(account);
        const file = await this.owned_table(account_id, b.table);
        const col_defs = await this.web_file_manager.get_columns(account_id, file.id);
        const others = await this.ai_columns.list(account_id, file.id);
        const settings = this.checked(() => parse_ai_column(b, col_defs, others));
        const saved = await this.ai_columns.save(account_id, file.id, settings, this.now());
        return { column: public_column(saved) };
    }

    /** The column is an ordinary column again; its values stay. */
    async remove(account_id: number, file_id: unknown, field: unknown) {
        const file = await this.owned_table(account_id, file_id);
        const col = await this.column(account_id, file.id, field);
        await this.ai_columns.remove(account_id, file.id, col.field);
        return { removed: true };
    }

    // The AI column's own column and its live inputs, or null when it can't be filled
    private async setup(account_id: number, file_id: number, col: AiColumn) {
        const col_defs = (await this.web_file_manager.get_columns(account_id, file_id)).filter(
            live
        );
        const target = col_defs.find(c => c.field === col.field);
        if (!target || target.col_type === LINK_TYPE) return null;
        const by_field = new Map<string, any>(col_defs.map(c => [c.field, c]));
        const ok = col.inputs.every(f => by_field.has(f) && by_field.get(f).col_type !== LINK_TYPE);
        if (!ok) return null;
        const type = column_type(target);
        return {
            target,
            type,
            hash: settings_hash(col, type),
            input_names: col.inputs.map(f => by_field.get(f).headerName as string)
        };
    }

    // The rows of the table whose cell is out of date: with inputs (to ask the model) and
    // without (null, free). `ids`: only these rows; otherwise the whole table.
    private async stale_rows(
        account_id: number,
        file_id: number,
        col: AiColumn,
        hash: string,
        ids?: string[]
    ) {
        const rows = await this._collections.get_dg_row(account_id, file_id);
        const projection = { _id: 1, [`${ROW_STATE_KEY}.${col.field}`]: 1 };
        col.inputs.forEach(f => (projection[f] = 1));
        let filter = {};
        if (ids) {
            const object_ids = ids.filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
            if (object_ids.length === 0) return { todo: [], empty: [] };
            filter = { _id: { $in: object_ids } };
        }
        const todo: Todo[] = [];
        const empty: Todo[] = [];
        for await (const doc of rows.find(filter, { projection })) {
            const h = cell_hash(hash, doc, col.inputs);
            if (!is_stale(doc, col.field, h)) continue;
            (has_inputs(doc, col.inputs) ? todo : empty).push({ doc, hash: h });
        }
        return { todo, empty };
    }

    /**
     * `{ rows, empty, left, limit, available }`: how many AI rows filling the column would use
     * (its out-of-date cells with something to read), and how many the month has left, for the
     * app to ask before it fills.
     */
    async estimate(account_id: number, file_id: unknown, field: unknown) {
        const account = await this.account_svc.get(account_id);
        if (!account) throw new NotFoundException();
        const file = await this.owned_table(account_id, file_id);
        const col = await this.column(account_id, file.id, field);
        const setup = await this.setup(account_id, file.id, col);
        if (!setup) {
            throw new BadRequestException("The column or the columns it reads aren't there");
        }
        const { todo, empty } = await this.stale_rows(account_id, file.id, col, setup.hash);
        const allowance = ai_allowance(account);
        const used = await this.ai_usage.get(account_id, usage_month(this.now()));
        return {
            rows: todo.length,
            empty: empty.length,
            left: Math.max(0, allowance.rows - used.rows),
            limit: allowance.rows,
            available: this.ai_client.available() && allowance.verified
        };
    }

    /** The owner confirmed: the processor fills the column's out-of-date cells. */
    async fill(account_id: number, file_id: unknown, field: unknown) {
        const account = await this.account_svc.get(account_id);
        if (!account) throw new NotFoundException();
        await this.tracking_manager.check_account_lock(account);
        await this.tracking_manager.check_not_read_only(account);
        const file = await this.owned_table(account_id, file_id);
        await this.tracking_manager.check_table_lock(file.id);
        const col = await this.column(account_id, file.id, field);
        const setup = await this.setup(account_id, file.id, col);
        if (!setup) {
            throw new BadRequestException("The column or the columns it reads aren't there");
        }
        await this.ai_columns.fill(account_id, file.id, col.field, setup.hash, this.now());
        return { column: public_column(await this.column(account_id, file.id, col.field)) };
    }

    /*** The processor ***/

    /** One turn: fills the next column with work waiting, if any. Never throws. */
    async tick() {
        if (this.running) return;
        this.running = true;
        try {
            const col = await this.ai_columns.claim(this.now());
            if (col) await this.run(col);
        } catch (ex) {
            logger.error(`AI column processor: ${ex && ex.message}`);
        } finally {
            this.running = false;
        }
    }

    /** Computes a claimed column's out-of-date cells, at most max_cells_per_run of them. */
    async run(col: AiColumn) {
        const { account_id, file_id } = col;
        let computed = 0;
        let more = false;
        let changes: Partial<Pick<AiColumn, 'state' | 'stopped_reason' | 'auto'>> = {};
        let written = false;
        let keep = false;
        try {
            const file = await this.file_directory_svc.get_by_id(file_id);
            const account = await this.account_svc.get(account_id);
            if (!file || file.deleted || file.account_id !== account_id || !account) {
                await this.ai_columns.remove_table(account_id, file_id);
                return;
            }
            // The work claimed waits for a later turn, when the lock is gone (and while the
            // account is read-only, #184: over its plan's caps, so nothing is written)
            if (
                account.locked ||
                file.locked ||
                (await this.tracking_manager.plan_state_of(account)) === 'read_only'
            ) {
                keep = true;
                return;
            }
            const setup = await this.setup(account_id, file_id, col);
            if (!setup) {
                changes = { auto: false, state: 'idle', stopped_reason: null };
                return;
            }
            // The settings (or the column's type) changed since the owner confirmed: their cost
            // wasn't, so the column waits for a new fill
            if (setup.hash !== col.filled_hash) {
                changes = { auto: false, state: 'idle', stopped_reason: null };
                return;
            }

            const ids = col.full ? undefined : col.dirty_ids || [];
            const { todo, empty } = await this.stale_rows(
                account_id,
                file_id,
                col,
                setup.hash,
                ids
            );
            if (empty.length > 0) {
                await this.write_cells(account_id, file_id, col, setup.type, empty, null);
                written = true;
            }
            let batch_rows = todo;
            if (batch_rows.length > AI_COLUMN_LIMITS.max_cells_per_run) {
                batch_rows = batch_rows.slice(0, AI_COLUMN_LIMITS.max_cells_per_run);
                more = true;
            }

            let stop: StopReason | null = null;
            const done = new Set<Todo>();
            if (batch_rows.length > 0 && !this.ai_client.available()) stop = 'off';

            const batches = stop ? [] : chunks(batch_rows);
            let next = 0;
            const worker = async () => {
                while (next < batches.length && !stop) {
                    const batch = batches[next++];
                    const res = await this.compute(account, col, setup, batch);
                    res.done.forEach(t => done.add(t));
                    computed += res.counted;
                    if (res.done.length > 0) written = true;
                    if (res.stop && !stop) stop = res.stop;
                }
            };
            const workers = Math.min(AI_COLUMN_LIMITS.parallel_calls, batches.length);
            await Promise.all(Array.from({ length: workers }, worker));

            if (stop) {
                more = false;
                // Every out-of-date cell left gets the note, the ones past the run's cap too
                const left = todo.filter(t => !done.has(t));
                await this.mark_stopped(account_id, file_id, col.field, left, stop);
                written = written || left.length > 0;
                changes = { state: 'stopped', stopped_reason: stop };
            } else {
                changes = { state: more ? 'filling' : 'done', stopped_reason: null };
            }
        } catch (ex) {
            logger.error(`AI column ${file_id}/${col.field} failed: ${ex && ex.message}`);
            changes = { state: 'stopped', stopped_reason: 'error' };
            more = false;
        } finally {
            await this.ai_columns.release(col, changes, computed, more, keep);
            if (written) {
                this.notify_svc.ws_pr_send_to_fe({
                    client_id: _c.HORIZON_PRC_WS_CLIENT_ID,
                    file_id,
                    account_id,
                    event: 'AI_COLUMN_FILLED'
                });
            }
        }
    }

    /**
     * One model call for up to rows_per_call cells. Takes the rows from the month's allowance
     * first (as many as are left when not all are), and charges the call. `counted`: the AI
     * rows used; `stop`: why the column can't go on.
     */
    private async compute(
        account,
        col: AiColumn,
        setup: { target: any; type: AiColumnType; input_names: string[] },
        batch: Todo[]
    ): Promise<{ done: Todo[]; counted: number; stop: StopReason | null }> {
        const month = usage_month(this.now());
        if (await this.ai_spend.paused(month)) return { done: [], counted: 0, stop: 'paused' };
        const allowance = ai_allowance(account);
        let rows = batch;
        let stop: StopReason | null = null;
        const reserve = (n: number) =>
            this.ai_usage.reserve_rows(
                account.id,
                month,
                n,
                allowance.rows,
                allowance.budget_micros
            );
        if (!(await reserve(rows.length))) {
            const used = await this.ai_usage.get(account.id, month);
            const left = allowance.rows - used.rows;
            if (
                left <= 0 ||
                used.cost_micros >= allowance.budget_micros ||
                !(await reserve(left))
            ) {
                return { done: [], counted: 0, stop: 'limit' };
            }
            rows = batch.slice(0, left);
            stop = 'limit';
        }

        const spent = [];
        try {
            const res = await this.ai_client.json({
                system: AI_COLUMN_SYSTEM,
                prompt: column_prompt(
                    { name: setup.target.headerName, type: setup.type },
                    col.prompt,
                    setup.input_names,
                    rows.map(t => row_inputs(t.doc, col.inputs))
                ),
                schema: column_schema(setup.type),
                max_tokens: column_max_tokens(rows.length)
            });
            spent.push({ model: res.model, usage: res.usage });
            const values = check_answer(res.data, rows.length, setup.type);
            await this.write_cells(account.id, col.file_id, col, setup.type, rows, values);
            return { done: rows, counted: rows.length, stop };
        } catch (ex) {
            logger.error(`AI column call failed for acct ${account.id}: ${ex && ex.message}`);
            if (ex instanceof AiModelError) {
                // Answered and paid for, but not usable: the rows count
                if (ex.usage) spent.push({ model: ex.model, usage: ex.usage });
                return { done: [], counted: rows.length, stop: 'error' };
            }
            // No answer: the rows are handed back
            await this.ai_usage.release_rows(account.id, month, rows.length);
            return { done: [], counted: 0, stop: 'error' };
        } finally {
            await this.ai_spend.charge(account.id, month, spent);
        }
    }

    /**
     * Writes computed cells (`values[i]` for `rows[i]`; all null when `values` is null) with
     * their hash, only to rows whose inputs still hold what was read: a row changed meanwhile
     * is computed again on its own turn.
     */
    private async write_cells(
        account_id: number,
        file_id: number,
        col: AiColumn,
        type: AiColumnType,
        rows: Todo[],
        values: (string | number | null)[] | null
    ) {
        if (rows.length === 0) return;
        const coll = await this._collections.get_dg_row(account_id, file_id);
        const ops = rows.map((t, i) => {
            const filter = { _id: t.doc._id };
            col.inputs.forEach(f => (filter[f] = t.doc[f] === undefined ? null : t.doc[f]));
            const value = values ? stored_value(values[i], type) : null;
            return {
                updateOne: {
                    filter,
                    update: {
                        $set: {
                            [col.field]: value,
                            [`${ROW_STATE_KEY}.${col.field}`]: { h: t.hash }
                        }
                    }
                }
            };
        });
        await coll.bulkWrite(ops, { ordered: false });
    }

    // The cells left empty get the reason as a note, until they're computed
    private async mark_stopped(
        account_id: number,
        file_id: number,
        field: string,
        rows: Todo[],
        reason: StopReason
    ) {
        if (rows.length === 0) return;
        const coll = await this._collections.get_dg_row(account_id, file_id);
        for (const part of chunks(rows, 1000)) {
            await coll.updateMany(
                { _id: { $in: part.map(t => t.doc._id) } },
                { $set: { [`${ROW_STATE_KEY}.${field}.s`]: reason } }
            );
        }
    }
}
