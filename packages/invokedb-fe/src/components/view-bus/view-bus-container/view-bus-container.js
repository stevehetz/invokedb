import { bus } from '@/core/bus';
import AlertDialog from '../alert-dialog';
import ConfirmDialog from '../confirm-dialog';
import InputDialog from '../input-dialog';
import UploadDialog from '../upload-dialog';
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
		'container-dialog': ContainerDialog,
	},
	mounted() {
		this.exposeComponentMethods();
	},
	methods: {
		exposeComponentMethods() {
			// AlertDialog
			bus.on('alert-dialog:open', this.$refs.alert_dialog.open_dialog);
			bus.on('alert-dialog:close', this.$refs.alert_dialog.close_dialog);

			// ConfirmDialog
			bus.on('confirm-dialog:open', this.$refs.confirm_dialog.open_dialog);
			bus.on('confirm-dialog:close', this.$refs.confirm_dialog.close_dialog);

			// InputDialog
			bus.on('input-dialog:open', this.$refs.input_dialog.open_dialog);
			bus.on('input-dialog:close', this.$refs.input_dialog.close_dialog);
			bus.on('input-dialog:processing', this.$refs.input_dialog.set_processing);

			// UploadDialog
			bus.on('upload-dialog:open', this.$refs.upload_dialog.open_dialog);
			bus.on('upload-dialog:close', this.$refs.upload_dialog.close_dialog);

			// ContainerDialog
			bus.on('container-dialog:open', this.$refs.container_dialog.open_dialog);
			bus.on('container-dialog:close', this.$refs.container_dialog.close_dialog);

			// Notify
			bus.on('notify:info', notify.info);
			bus.on('notify:warn', notify.warn);
			bus.on('notify:success', notify.success);
			bus.on('notify:error', notify.error);
		},
	},
};
