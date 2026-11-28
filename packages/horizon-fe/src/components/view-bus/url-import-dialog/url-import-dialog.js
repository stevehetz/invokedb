// Imports a table from a Google Sheet or a CSV / JSON URL, or changes an imported table's
// source and re-sync settings (#144). Opened with `url-import-dialog:open`
// ({ source?, callback(form, sync_now) }): no source means a new table. The caller closes it
// with `url-import-dialog:close` or re-enables it with `url-import-dialog:processing`.

/**
 * @typedef {{ name: string, url: string, mode: string, key_column: string | null,
 *   schedule: string }} UrlImportForm
 */
import DemoOff from '@/components/demo-off/index.vue';
import { is_demo_account } from '@/core/demo';

export default {
    name: 'UrlImportDialog',
    components: { DemoOff },
    data: () => {
        return {
            // The no-signup demo (#333) reaches no outside URL
            demo: false,
            dialog_visible: false,
            /** @type {any} */
            source: null,
            name: '',
            url: '',
            mode: 'replace',
            key_column: '',
            schedule: 'off',
            processing: false,
            /** @type {((form: UrlImportForm, sync_now: boolean) => void) | null} */
            confirm_callback: null
        };
    },
    computed: {
        /** @returns {boolean} */
        is_new() {
            return !this.source;
        },
        /** @returns {string} */
        title() {
            return this.is_new ? 'New table from a URL' : 'Table source';
        },
        /** @returns {boolean} */
        can_confirm() {
            if (this.demo) return false;
            if (!this.url.trim()) return false;
            if (this.is_new && !this.name.trim()) return false;
            if (this.mode === 'upsert' && !this.key_column.trim()) return false;
            return true;
        }
    },
    methods: {
        /** @param {{ source?: any, callback: (form: UrlImportForm, sync_now: boolean) => void }} data */
        async open_dialog(data) {
            const source = data.source || null;
            this.demo = is_demo_account();
            this.source = source;
            this.confirm_callback = data.callback;
            this.name = '';
            this.url = source ? source.url : '';
            this.mode = source ? source.mode : 'replace';
            this.key_column =
                source && source.key_column ? source.key_column : '';
            this.schedule = source ? source.schedule : 'off';
            this.processing = false;
            this.dialog_visible = true;
            await this.$nextTick();
            const input = /** @type {any} */ (this.$refs.url_input);
            if (input) input.focus();
        },

        close_dialog() {
            this.dialog_visible = false;
        },

        /** @param {boolean} value */
        set_processing(value) {
            this.processing = value;
        },

        /** @param {number} time */
        format_time(time) {
            return new Date(time).toLocaleString();
        },

        /** @param {boolean} sync_now */
        confirm_handler(sync_now) {
            if (
                !this.can_confirm ||
                this.processing ||
                !this.confirm_callback
            ) {
                return;
            }
            this.processing = true;
            this.confirm_callback(
                {
                    name: this.name.trim(),
                    url: this.url.trim(),
                    mode: this.mode,
                    key_column:
                        this.mode === 'upsert' ? this.key_column.trim() : null,
                    schedule: this.schedule
                },
                this.is_new || sync_now
            );
        }
    }
};
