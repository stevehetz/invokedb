// Picks a table template (#142) and a name for the new table. Opened with
// `template-dialog:open` ({ templates, callback(template_id, name) }); the caller closes it with
// `template-dialog:close` or re-enables it with `template-dialog:processing`.
export default {
    name: 'TemplateDialog',
    data: () => {
        return {
            dialog_visible: false,
            /** @type {any[]} */
            templates: [],
            /** @type {string | null} */
            selected_id: null,
            name: '',
            processing: false,
            /** @type {((id: string, name: string) => void) | null} */
            confirm_callback: null
        };
    },
    methods: {
        /** @param {{ templates: any[], callback: (id: string, name: string) => void }} data */
        open_dialog(data) {
            this.templates = data.templates || [];
            this.confirm_callback = data.callback;
            this.selected_id = null;
            this.name = '';
            this.processing = false;
            this.dialog_visible = true;
        },

        close_dialog() {
            this.dialog_visible = false;
        },

        /** @param {boolean} value */
        set_processing(value) {
            this.processing = value;
        },

        /** @param {any} template */
        async select(template) {
            this.selected_id = template.id;
            this.name = template.table_name;
            await this.$nextTick();
            const input = /** @type {any} */ (this.$refs.name_input);
            if (input) input.focus();
        },

        confirm_handler() {
            if (
                !this.selected_id ||
                this.processing ||
                !this.confirm_callback
            ) {
                return;
            }
            this.processing = true;
            this.confirm_callback(this.selected_id, this.name.trim());
        }
    }
};
