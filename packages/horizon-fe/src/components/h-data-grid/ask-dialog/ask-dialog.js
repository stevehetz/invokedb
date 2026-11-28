// Ask your data (#149): a question about the table goes to the backend, which has Claude turn it
// into an /api/v1/query call, runs it read-only and answers. Shows the answer, the rows behind
// it and the API call, so the user can learn the API from it. Asked to change rows (#204), it
// shows the AI's edit before and after; Apply writes it, Undo puts it back. Opened from the
// grid's top bar
// through `container-dialog:open` with `props: { file }`.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { bus } from '@/core/bus';
import { ai_http } from '@/core/context/ai/ai-http';
import { table_display_name } from '../table-name';
import CleanupPanel from '../cleanup-panel/index.vue';
import {
    cell_text,
    column_cell_text,
    edit_batches,
    rows_text
} from './edit-batches';

export const MAX_QUESTION_LENGTH = 500;
// Pasted text (#207); the server's limits from /ai/status replace these
export const MAX_PASTE_LENGTH = 20000;
export const MAX_PASTE_ROWS = 200;

/**
 * Whether text pasted into the question field is rows rather than a question: more than one
 * line, or longer than a question can be. It then goes to the paste box instead.
 * @param {string} text
 */
export function looks_like_rows(text) {
    const t = String(text || '').trim();
    return t.length > MAX_QUESTION_LENGTH || /\n/.test(t);
}

/**
 * @typedef {{ _id: string, before: Record<string, any>,
 *   after: Record<string, any> }} EditRow
 */

// The rows of the last edit applied to each table (#204), so Undo is still offered when the
// dialog is opened again. Gone on a page load.
/** @type {Map<number, EditRow[]>} */
const last_edits = new Map();

export { edit_batches, cell_text };

/** @param {any} ex @param {string} fallback */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

export default defineComponent({
    props: ['props'],

    components: { CleanupPanel },

    data() {
        return {
            question: '',
            asking: false,
            /** @type {string | null} */
            error: null,
            /** @type {any} */
            result: null,
            /** @type {any} */
            usage: null,
            // Generated rows this month (#148): `{ used, limit }`
            /** @type {any} */
            rows_usage: null,
            copied: false,
            /** @type {number | undefined} */
            copied_timer: undefined,
            max_length: MAX_QUESTION_LENGTH,
            // Editing rows (#204): applying or undoing, whether the edit shown is applied, what
            // happened, and the rows Undo puts back
            applying: false,
            undoing: false,
            edit_applied: false,
            /** @type {string | null} */
            edit_message: null,
            /** @type {EditRow[] | null} */
            undo_rows: last_edits.get(this.props.file.id) || null,
            // Clean up (#206): a new number starts a new scan in the cleanup panel; 0 hides it
            cleanup_key: 0,
            // Paste text (#207): the box is open, its text, and the server's limits
            pasting: false,
            paste_text: '',
            max_paste_length: MAX_PASTE_LENGTH,
            max_paste_rows: MAX_PASTE_ROWS
        };
    },

    computed: {
        /** @returns {string} */
        table_name() {
            return table_display_name(this.props.file.name);
        },

        /** @returns {boolean} */
        can_ask() {
            const q = this.question.trim();
            return !this.asking && q !== '' && q.length <= MAX_QUESTION_LENGTH;
        },

        /** @returns {boolean} */
        can_extract() {
            const t = this.paste_text;
            return (
                !this.asking &&
                t.trim() !== '' &&
                t.length <= this.max_paste_length
            );
        },

        // The table the rows shown were read from (#322): this one, or another of the
        // account's tables the AI read
        /** @returns {string} */
        rows_table_name() {
            const t = this.result && this.result.table;
            return t ? table_display_name(t) : this.table_name;
        },

        /** @returns {string[]} */
        columns() {
            return (this.result && this.result.columns) || [];
        },

        /** @returns {any[]} */
        rows() {
            return (this.result && this.result.rows) || [];
        },

        // Rows the AI proposed (#234): `{ rows (keyed by field), columns: [{ field, name }] }`
        /** @returns {any} */
        proposed() {
            const p = this.result && this.result.proposed;
            return p && p.rows && p.rows.length > 0 ? p : null;
        },

        // An edit the AI proposed (#204): `{ summary, columns: [{ field, name, type }],
        // rows: [{ _id, before, after }], matching, limit, capped }`
        /** @returns {any} */
        edit() {
            const e = this.result && this.result.edit;
            return e && e.rows && e.rows.length > 0 ? e : null;
        },

        /** @returns {boolean} */
        used_up() {
            return (
                !!this.usage &&
                this.usage.verified !== false &&
                (this.usage.used >= this.usage.limit ||
                    this.usage.budget_used >= 1)
            );
        },

        /** @returns {boolean} */
        unverified() {
            return !!this.usage && this.usage.verified === false;
        }
    },

    async mounted() {
        try {
            const status = await ai_http.status();
            this.usage = status && status.usage;
            this.rows_usage = status && status.rows;
            const limits = (status && status.limits) || {};
            if (limits.max_import_text_length > 0) {
                this.max_paste_length = limits.max_import_text_length;
            }
            if (limits.max_import_rows > 0) {
                this.max_paste_rows = limits.max_import_rows;
            }
        } catch (ex) {
            this.error = message_of(ex, 'Could not load your AI usage');
        }
        const input = /** @type {HTMLElement | undefined} */ (
            this.$refs.question
        );
        if (input) input.focus();
    },

    beforeUnmount() {
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        cell_text,
        column_cell_text,

        /** @param {any} value @param {string} [type] the column's type */
        edit_cell(value, type) {
            const text = column_cell_text(value, type);
            return text === '' ? '(empty)' : text;
        },

        /**
         * @param {EditRow} row
         * @param {string} field
         */
        edit_changes(row, field) {
            return Object.prototype.hasOwnProperty.call(row.after, field);
        },

        // Writes rows (an edit, or an edit backwards), a batch at a time; the server only
        // writes a row that still holds `before`. Answers the rows written and the error that
        // stopped it, if one did (the batches before it are written).
        /** @param {EditRow[]} rows */
        async write_edit(rows) {
            /** @type {Set<string>} */
            const updated = new Set();
            /** @type {any} */
            let error = null;
            try {
                for (const batch of edit_batches(rows)) {
                    const res = await ai_http.apply_edit(
                        this.props.file.id,
                        batch
                    );
                    ((res && res.updated) || []).forEach(
                        /** @param {string} id */ id => updated.add(id)
                    );
                }
            } catch (ex) {
                error = ex;
            }
            if (updated.size > 0 && this.props.on_edited) {
                this.props.on_edited();
            }
            return { done: rows.filter(r => updated.has(r._id)), error };
        },

        /** @param {EditRow[] | null} rows */
        set_undo(rows) {
            this.undo_rows = rows && rows.length > 0 ? rows : null;
            if (this.undo_rows) last_edits.set(this.props.file.id, rows);
            else last_edits.delete(this.props.file.id);
        },

        async apply_edit() {
            if (!this.edit || this.applying || this.edit_applied) return;
            this.applying = true;
            this.error = null;
            /** @type {EditRow[]} */
            const rows = this.edit.rows;
            const { done, error } = await this.write_edit(rows);
            this.edit_applied = !error;
            const skipped = rows.length - done.length;
            this.edit_message = error
                ? `Changed ${rows_text(done.length)} before it stopped.`
                : `Changed ${rows_text(done.length)}.` +
                  (skipped > 0
                      ? ` ${rows_text(skipped)} changed or deleted since the` +
                        ' preview were left as they are.'
                      : '');
            if (error)
                this.error = message_of(error, 'Could not apply the edit');
            // Undo covers what was written, even when it stopped part way
            if (done.length > 0 || !error) this.set_undo(done);
            this.applying = false;
        },

        // Puts back the rows of the last edit, where they still hold its new values
        async undo_edit() {
            if (!this.undo_rows || this.undoing) return;
            this.undoing = true;
            this.error = null;
            const undo_rows = this.undo_rows;
            const rows = undo_rows.map(r => ({
                _id: r._id,
                before: r.after,
                after: r.before
            }));
            const { done, error } = await this.write_edit(rows);
            if (error) {
                this.error = message_of(error, 'Could not undo the edit');
                // What wasn't put back can still be
                const back = new Set(done.map(r => r._id));
                this.set_undo(undo_rows.filter(r => !back.has(r._id)));
            } else {
                const skipped = rows.length - done.length;
                this.edit_message =
                    `Undone: ${rows_text(done.length)} back as they were.` +
                    (skipped > 0
                        ? ` ${rows_text(skipped)} changed since were left as` +
                          ' they are.'
                        : '');
                this.set_undo(null);
            }
            this.undoing = false;
        },

        // The proposed rows go to the grid as new rows to review (`props.on_generated`); the
        // user saves them there. The grid answers why when it can't take them yet (column edit
        // mode, an update running): the dialog then stays open, so the rows aren't lost.
        add_rows() {
            if (!this.proposed || !this.props.on_generated) return;
            const problem = this.props.on_generated(this.proposed.rows);
            if (problem) {
                this.error = problem;
                return;
            }
            bus.$emit('container-dialog:close');
        },

        // Scans the table for problems (#206), in place of a question's answer
        clean_up() {
            if (this.asking || this.used_up || this.unverified) return;
            this.result = null;
            this.error = null;
            this.cleanup_key++;
        },

        /** @param {any} usage */
        cleanup_usage(usage) {
            if (usage) this.usage = usage;
        },

        // Opens or closes the paste box (#207)
        toggle_paste() {
            this.pasting = !this.pasting;
            if (this.pasting) this.focus_paste();
        },

        focus_paste() {
            this.$nextTick(() => {
                const box = /** @type {HTMLElement | undefined} */ (
                    this.$refs.paste
                );
                if (box) box.focus();
            });
        },

        // Rows pasted into the question field go to the paste box instead (#207)
        /** @param {ClipboardEvent} event */
        question_paste(event) {
            const text = event.clipboardData
                ? event.clipboardData.getData('text')
                : '';
            if (!looks_like_rows(text)) return;
            event.preventDefault();
            this.pasting = true;
            this.paste_text = text.slice(0, this.max_paste_length);
            this.focus_paste();
        },

        // Pasted text becomes rows to review (#207), shown like rows the AI proposed
        async extract() {
            if (!this.can_extract || this.used_up || this.unverified) return;
            this.asking = true;
            this.error = null;
            this.cleanup_key = 0;
            try {
                const res = await ai_http.import_text(
                    this.props.file.id,
                    this.paste_text
                );
                this.result = res;
                this.edit_applied = false;
                if (res && res.usage) this.usage = res.usage;
                if (res && res.rows_usage) this.rows_usage = res.rows_usage;
            } catch (ex) {
                this.error = message_of(
                    ex,
                    'Could not turn that text into rows'
                );
            }
            this.asking = false;
        },

        async ask() {
            if (!this.can_ask) return;
            this.asking = true;
            this.error = null;
            this.cleanup_key = 0;
            try {
                const res = await ai_http.ask(
                    this.props.file.id,
                    this.question.trim()
                );
                this.result = res;
                this.edit_applied = false;
                if (res && res.usage) this.usage = res.usage;
                if (res && res.rows_usage) this.rows_usage = res.rows_usage;
            } catch (ex) {
                this.error = message_of(ex, 'Could not answer that question');
            }
            this.asking = false;
        },

        copy_call() {
            if (!this.result || !this.result.api_call) return;
            copy(this.result.api_call.curl);
            this.copied = true;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.copied = false),
                1500
            );
        }
    }
});
