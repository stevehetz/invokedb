// @ts-nocheck: not type-checked yet
import { bus } from '@/core/bus';
import AlertDialog from '../alert-dialog';
import ConfirmDialog from '../confirm-dialog';
import InputDialog from '../input-dialog';
import UploadDialog from '../upload-dialog';
import TemplateDialog from '../template-dialog';
import UrlImportDialog from '../url-import-dialog';
import ContainerDialog from '../container-dialog';
import Notify from '../notify';

const notify = new Notify();

export default {
    name: 'ViewBusContainer',
    components: {
        'alert-dialog': AlertDialog,
        'confirm-dialog': ConfirmDialog,
        'input-dialog': InputDialog,
        'upload-dialog': UploadDialog,
        'template-dialog': TemplateDialog,
        'url-import-dialog': UrlImportDialog,
        'container-dialog': ContainerDialog
    },
    mounted() {
        this.exposeComponentMethods();
    },
    beforeUnmount() {
        // The app shell unmounts when the user goes to the public site and
        // mounts again on the way back, so take this visit's handlers off
        (this.bus_handlers || []).forEach(([event, handler]) =>
            bus.$off(event, handler)
        );
        this.bus_handlers = [];
    },
    methods: {
        exposeComponentMethods() {
            const refs = this.$refs;
            const handlers = [
                // AlertDialog
                ['alert-dialog:open', refs.alert_dialog.open_dialog],
                ['alert-dialog:close', refs.alert_dialog.close_dialog],

                // ConfirmDialog
                ['confirm-dialog:open', refs.confirm_dialog.open_dialog],
                ['confirm-dialog:close', refs.confirm_dialog.close_dialog],

                // InputDialog
                ['input-dialog:open', refs.input_dialog.open_dialog],
                ['input-dialog:close', refs.input_dialog.close_dialog],
                ['input-dialog:processing', refs.input_dialog.set_processing],

                // UploadDialog
                ['upload-dialog:open', refs.upload_dialog.open_dialog],
                ['upload-dialog:close', refs.upload_dialog.close_dialog],

                // TemplateDialog
                ['template-dialog:open', refs.template_dialog.open_dialog],
                ['template-dialog:close', refs.template_dialog.close_dialog],
                [
                    'template-dialog:processing',
                    refs.template_dialog.set_processing
                ],

                // UrlImportDialog
                ['url-import-dialog:open', refs.url_import_dialog.open_dialog],
                [
                    'url-import-dialog:close',
                    refs.url_import_dialog.close_dialog
                ],
                [
                    'url-import-dialog:processing',
                    refs.url_import_dialog.set_processing
                ],

                // ContainerDialog
                ['container-dialog:open', refs.container_dialog.open_dialog],
                ['container-dialog:close', refs.container_dialog.close_dialog],

                // Notify
                ['notify:info', notify.info],
                ['notify:warn', notify.warn],
                ['notify:success', notify.success],
                ['notify:error', notify.error]
            ];
            handlers.forEach(([event, handler]) => bus.$on(event, handler));
            // Not in data(): only beforeUnmount reads it
            this.bus_handlers = handlers;
        }
    }
};
