import { defineComponent, ref } from 'vue';

export default defineComponent({
	name: 'ToastNotification',
	setup() {
		const showToast = ref(false);
		const type = ref('info');
		const message = ref(null);
		const timeout = ref(null);
		const lock = ref(false);
		const backdrop = ref(false);

		const info = (msg, duration, opts = {}) => {
			if (lock.value) return;
			type.value = 'info';
			show(msg, duration, opts);
		};

		const error = (msg, duration, opts = {}) => {
			if (lock.value) return;
			type.value = 'error';
			show(msg, duration, opts);
		};

		const success = (msg, duration, opts = {}) => {
			if (lock.value) return;
			type.value = 'success';
			show(msg, duration, opts);
		};

		const show = (msg, duration, opts = {}) => {
			if (lock.value) return;
			lock.value = opts.lock;
			backdrop.value = opts.backdrop;
			window.clearTimeout(timeout.value);
			showToast.value = true;
			message.value = msg;
			if (duration) {
				timeout.value = window.setTimeout(() => {
					showToast.value = false;
					message.value = null;
					lock.value = false;
				}, duration);
			}
		};

		const hide = () => {
			if (lock.value) return;
			window.clearTimeout(timeout.value);
			showToast.value = false;
			message.value = null;
			type.value = 'info';
		};

		return {
			showToast,
			type,
			message,
			lock,
			backdrop,
			info,
			error,
			success,
			show,
			hide,
		};
	},
});
