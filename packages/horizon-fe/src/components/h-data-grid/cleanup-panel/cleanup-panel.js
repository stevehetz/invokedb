// AI data cleanup (#206), inside Ask AI: scans the table (one question) and lists the problems
// it found, each with its fix to review: an edit (cells before and after, as #204's edits) or
// duplicate rows to delete, ticked one by one. Nothing changes until Apply; Undo puts the cells
// back and the deleted rows back (as new rows). Fixes of the same cell build on each other, so
// for a cell in several ticked fixes the last one's value is written.
import { defineComponent } from 'vue';
import { ai_http } from '@/core/context/ai/ai-http';
import { cell_text, edit_batches, rows_text } from '../ask-dialog/edit-batches';

/**
 * @typedef {{ _id: string, before: Record<string, any>,
 *   after: Record<string, any> }} EditRow
 * @typedef {{ _id: string, before: Record<string, any>, duplicate_of: string,
 *   reason?: string }} DeleteRow
 * @typedef {{ field: string, name: string, type: string }} Column
 * @typedef {{ id: string, kind: string, source: string, column: Column | null,
 *   title: string, detail: string, count: number, fixable: number,
 *   examples: string[], edit: { columns: Column[], rows: EditRow[] } | null,
 *   delete: { columns: Column[], rows: DeleteRow[] } | null }} Problem
 * @typedef {{ edits: EditRow[], deleted: DeleteRow[] }} Applied
 */

// The last cleanup applied to each table, so Undo is still offered when the dialog is opened
// again. Gone on a page load.
/** @type {Map<number, Applied>} */
const last_cleanups = new Map();

/**
 * The ticked fixes as one edit and one list of deletes. A row being deleted isn't edited; a
 * cell in several fixes gets the last one's value (each builds on the ones before it), and its
 * stored value as `before`.
 * @param {Problem[]} problems in the order the scan answered them
 * @param {Record<string, boolean>} fixes ticked edit fixes, by problem id
 * @param {Record<string, boolean>} deletes ticked rows to delete, by row id
 * @returns {{ edits: EditRow[], deletes: DeleteRow[] }}
 */
export function merge_fixes(problems, fixes, deletes) {
    /** @type {DeleteRow[]} */
    const to_delete = [];
    /** @type {Set<string>} */
    const deleting = new Set();
    problems.forEach(p =>
        (p.delete ? p.delete.rows : []).forEach(r => {
            if (!deletes[r._id] || deleting.has(r._id)) return;
            deleting.add(r._id);
            to_delete.push(r);
        })
    );
    /** @type {Map<string, EditRow>} */
    const edits = new Map();
    problems.forEach(p => {
        if (!p.edit || !fixes[p.id]) return;
        p.edit.rows.forEach(r => {
            if (deleting.has(r._id)) return;
            let e = edits.get(r._id);
            if (!e) {
                e = { _id: r._id, before: {}, after: {} };
                edits.set(r._id, e);
            }
            Object.keys(r.after).forEach(f => {
                if (!Object.prototype.hasOwnProperty.call(e.before, f)) {
                    e.before[f] = r.before[f];
                }
                e.after[f] = r.after[f];
            });
        });
    });
    return { edits: [...edits.values()], deletes: to_delete };
}

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['file', 'on_edited'],
    emits: ['usage'],

    data() {
        return {
            scanning: true,
            applying: false,
            undoing: false,
            applied: false,
            /** @type {string | null} */
            error: null,
            /** @type {string | null} */
            message: null,
            /** @type {any} */
            result: null,
            // Ticked edit fixes by problem id, and ticked rows to delete by row id
            /** @type {Record<string, boolean>} */
            fixes: {},
            /** @type {Record<string, boolean>} */
            deletes: {},
            // Problems whose rows are shown
            /** @type {Record<string, boolean>} */
            open: {},
            /** @type {Applied | null} */
            undo: last_cleanups.get(this.file.id) || null
        };
    },

    computed: {
        /** @returns {Problem[]} */
        problems() {
            return (this.result && this.result.problems) || [];
        },

        /** @returns {{ edits: EditRow[], deletes: DeleteRow[] }} */
        picked() {
            return merge_fixes(this.problems, this.fixes, this.deletes);
        },

        /** @returns {boolean} */
        can_apply() {
            const p = this.picked;
            return (
                !this.applying &&
                !this.undoing &&
                !this.applied &&
                p.edits.length + p.deletes.length > 0
            );
        }
    },

    mounted() {
        this.scan();
    },

    methods: {
        cell_text,
        rows_text,

        /** @param {any} value */
        shown(value) {
            const text = cell_text(value);
            return text === '' ? '(empty)' : text;
        },

        /** @param {EditRow} row @param {string} field */
        changes(row, field) {
            return Object.prototype.hasOwnProperty.call(row.after, field);
        },

        /** @param {Problem} p */
        toggle_open(p) {
            this.open = { ...this.open, [p.id]: !this.open[p.id] };
        },

        async scan() {
            this.scanning = true;
            this.error = null;
            try {
                const res = await ai_http.cleanup(this.file.id);
                this.result = res;
                /** @type {Record<string, boolean>} */
                const fixes = {};
                // The fixes from the checks in code start ticked; the AI's and every delete
                // wait for the user
                ((res && res.problems) || []).forEach(
                    /** @param {Problem} p */ p => {
                        if (p.edit) fixes[p.id] = p.source === 'rules';
                    }
                );
                this.fixes = fixes;
                this.deletes = {};
                this.$emit('usage', res && res.usage);
            } catch (ex) {
                this.error = message_of(ex, 'Could not scan the table');
            }
            this.scanning = false;
        },

        // Writes rows a batch at a time with `send`, which answers the ids written; answers
        // the rows written and the error that stopped it, if one did
        /**
         * @template {{ _id: string }} T
         * @param {T[]} rows
         * @param {(batch: T[]) => Promise<string[]>} send
         */
        async write(rows, send) {
            /** @type {Set<string>} */
            const done = new Set();
            /** @type {any} */
            let error = null;
            try {
                for (const batch of edit_batches(rows)) {
                    (await send(batch)).forEach(id => done.add(id));
                }
            } catch (ex) {
                error = ex;
            }
            return { done: rows.filter(r => done.has(r._id)), error };
        },

        /** @param {Applied | null} applied */
        set_undo(applied) {
            const keep =
                applied && applied.edits.length + applied.deleted.length > 0
                    ? applied
                    : null;
            this.undo = keep;
            if (keep) last_cleanups.set(this.file.id, keep);
            else last_cleanups.delete(this.file.id);
        },

        refresh() {
            if (this.on_edited) this.on_edited();
        },

        async apply() {
            if (!this.can_apply) return;
            this.applying = true;
            this.error = null;
            const { edits, deletes } = this.picked;
            const table = this.file.id;
            const removed = await this.write(deletes, async batch => {
                const res = await ai_http.delete_rows(
                    table,
                    batch.map(r => ({ _id: r._id, before: r.before }))
                );
                return (res && res.deleted) || [];
            });
            let changed = { done: /** @type {EditRow[]} */ ([]), error: null };
            if (!removed.error) {
                changed = await this.write(edits, async batch => {
                    const res = await ai_http.apply_edit(table, batch);
                    return (res && res.updated) || [];
                });
            }
            const error = removed.error || changed.error;
            const skipped =
                deletes.length -
                removed.done.length +
                (removed.error ? 0 : edits.length - changed.done.length);
            const parts = [];
            if (changed.done.length > 0) {
                parts.push(`Fixed ${rows_text(changed.done.length)}.`);
            }
            if (removed.done.length > 0) {
                parts.push(`Deleted ${rows_text(removed.done.length)}.`);
            }
            if (parts.length === 0) parts.push('Nothing was changed.');
            if (!error && skipped > 0) {
                parts.push(
                    `${rows_text(skipped)} changed or deleted since the scan were left as they are.`
                );
            }
            this.message = parts.join(' ');
            if (error)
                this.error = message_of(error, 'Could not apply the fixes');
            this.applied = !error;
            this.set_undo({ edits: changed.done, deleted: removed.done });
            if (changed.done.length + removed.done.length > 0) this.refresh();
            this.applying = false;
        },

        // Puts the cells back where they still hold the fixed values, and the deleted rows back
        async undo_cleanup() {
            if (!this.undo || this.undoing) return;
            this.undoing = true;
            this.error = null;
            const { edits, deleted } = this.undo;
            const table = this.file.id;
            const back = await this.write(
                edits.map(r => ({
                    _id: r._id,
                    before: r.after,
                    after: r.before
                })),
                async batch => {
                    const res = await ai_http.apply_edit(table, batch);
                    return (res && res.updated) || [];
                }
            );
            /** @type {DeleteRow[]} */
            let restored = [];
            /** @type {any} */
            let error = back.error;
            if (!error) {
                try {
                    for (const batch of edit_batches(deleted)) {
                        await ai_http.restore_rows(
                            table,
                            batch.map(r => r.before)
                        );
                        restored = restored.concat(batch);
                    }
                } catch (ex) {
                    error = ex;
                }
            }
            const undone = new Set(back.done.map(r => r._id));
            const put_back = new Set(restored.map(r => r._id));
            if (error) {
                this.error = message_of(error, 'Could not undo the cleanup');
                // What wasn't put back can still be
                this.set_undo({
                    edits: edits.filter(r => !undone.has(r._id)),
                    deleted: deleted.filter(r => !put_back.has(r._id))
                });
            } else {
                const skipped = edits.length - back.done.length;
                this.message =
                    `Undone: ${rows_text(back.done.length)} back as they were` +
                    (restored.length > 0
                        ? `, ${rows_text(restored.length)} put back`
                        : '') +
                    '.' +
                    (skipped > 0
                        ? ` ${rows_text(skipped)} changed since were left as they are.`
                        : '');
                this.set_undo(null);
            }
            if (back.done.length + restored.length > 0) this.refresh();
            this.undoing = false;
        }
    }
});
