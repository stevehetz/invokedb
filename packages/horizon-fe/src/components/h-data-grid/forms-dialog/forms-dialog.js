// A table's shareable forms (#145): make one from some of the table's columns, copy its public
// link or embed code, edit it, close or reopen it, and delete it. Opened from the grid's top bar
// through `container-dialog:open` with `props: { file }`.
import { defineComponent } from 'vue';
import copy from 'copy-to-clipboard';
import { bus } from '@/core/bus';
import {
    form_http,
    form_link,
    form_embed
} from '@/core/context/form/form-http';

/** @param {any} ex */
function message_of(ex, fallback) {
    return (ex && ex.message) || fallback;
}

/**
 * The editor's state for a form (or a new one): one row per column of the table, asked or not.
 * @param {any[]} columns @param {any} [form]
 */
function draft_of(columns, form) {
    const fields = (form && form.fields) || [];
    const by_field = new Map(fields.map(f => [f.field, f]));
    const asked = columns.map(c => {
        const f = by_field.get(c.field);
        return {
            field: c.field,
            name: c.name,
            type: c.type,
            ask: form ? !!f : true,
            required: f ? !!f.required : false,
            label: f ? f.label || '' : '',
            help: f ? f.help || '' : '',
            order: f ? fields.indexOf(f) : fields.length + columns.indexOf(c)
        };
    });
    // The form's questions first, in its order
    asked.sort((a, b) => a.order - b.order);
    return {
        id: form ? form.id : null,
        title: form ? form.title : '',
        description: form ? form.description : '',
        submit_label: form ? form.submit_label : '',
        thank_you: form ? form.thank_you : '',
        redirect_url: form ? form.redirect_url || '' : '',
        columns: asked
    };
}

export default defineComponent({
    props: ['props'],

    data() {
        return {
            /** @type {any[]} */
            forms: [],
            /** @type {any[]} */
            columns: [],
            loading: true,
            /** @type {string | null} */
            error: null,
            /** @type {any} */
            draft: null,
            saving: false,
            /** @type {string | null} */
            copied: null,
            /** @type {number | undefined} */
            copied_timer: undefined
        };
    },

    computed: {
        /** @returns {boolean} */
        can_save() {
            return (
                !!this.draft &&
                !this.saving &&
                this.draft.title.trim() !== '' &&
                this.draft.columns.some(c => c.ask)
            );
        }
    },

    async mounted() {
        await this.load();
    },

    beforeUnmount() {
        window.clearTimeout(this.copied_timer);
    },

    methods: {
        async load() {
            try {
                const res = await form_http.list(this.props.file.id);
                this.forms = (res && res.forms) || [];
                this.columns = (res && res.columns) || [];
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not load the forms');
            }
            this.loading = false;
        },

        new_form() {
            this.draft = draft_of(this.columns);
            this.draft.title = this.props.file.name;
        },

        /** @param {any} form */
        edit(form) {
            this.draft = draft_of(this.columns, form);
        },

        cancel() {
            this.draft = null;
        },

        /** @param {number} i @param {number} by */
        move(i, by) {
            const cols = this.draft.columns;
            const j = i + by;
            if (j < 0 || j >= cols.length) return;
            [cols[i], cols[j]] = [cols[j], cols[i]];
        },

        async save() {
            if (!this.can_save) return;
            const d = this.draft;
            const body = {
                title: d.title.trim(),
                description: d.description,
                submit_label: d.submit_label,
                thank_you: d.thank_you,
                redirect_url: d.redirect_url.trim() || null,
                fields: d.columns
                    .filter(c => c.ask)
                    .map(c => ({
                        field: c.field,
                        label: c.label,
                        required: c.required,
                        help: c.help
                    }))
            };
            this.saving = true;
            try {
                if (d.id) {
                    const form = await form_http.update(d.id, body);
                    this.replace(form);
                } else {
                    const form = await form_http.create({
                        ...body,
                        file_id: this.props.file.id
                    });
                    this.forms = [...this.forms, form];
                }
                this.draft = null;
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not save the form');
            }
            this.saving = false;
        },

        /** @param {any} form */
        replace(form) {
            this.forms = this.forms.map(f => (f.id === form.id ? form : f));
        },

        /** @param {any} form */
        async toggle_open(form) {
            try {
                this.replace(
                    await form_http.update(form.id, { open: !form.open })
                );
                this.error = null;
            } catch (ex) {
                this.error = message_of(ex, 'Could not change the form');
            }
        },

        /** @param {any} form */
        remove(form) {
            bus.$emit('confirm-dialog:open', {
                title: 'Delete form',
                message:
                    'Delete this form? Its link stops working. The rows it added stay in the table.',
                callback: async () => {
                    try {
                        await form_http.remove(form.id);
                        this.forms = this.forms.filter(f => f.id !== form.id);
                        if (this.draft && this.draft.id === form.id)
                            this.draft = null;
                        this.error = null;
                    } catch (ex) {
                        this.error = message_of(
                            ex,
                            'Could not delete the form'
                        );
                    }
                }
            });
        },

        /** @param {string} id */
        link(id) {
            return form_link(id);
        },

        /** @param {string} id */
        embed(id) {
            return form_embed(id);
        },

        /** @param {string} what @param {string} text */
        copy_text(what, text) {
            copy(text);
            this.copied = what;
            window.clearTimeout(this.copied_timer);
            this.copied_timer = window.setTimeout(
                () => (this.copied = null),
                1500
            );
        },

        /** @param {number} time */
        format_time(time) {
            return time ? new Date(time).toLocaleString() : '';
        }
    }
});
