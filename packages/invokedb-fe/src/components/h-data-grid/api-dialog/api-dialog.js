import { defineComponent, ref, onMounted } from 'vue';
import copy from 'copy-to-clipboard';
import { store } from '@/store';

export default defineComponent({
	name: 'MyComponent',
	props: {
		props: {
			type: Object,
			required: true,
		},
	},
	setup(props) {
		const tableName = ref(null);
		const getUrl = ref(null);
		const searchUrl = ref(null);
		const createUrl = ref(null);
		const updateUrl = ref(null);
		const deleteUrl = ref(null);
		const showCopiedPopup = ref({});

		onMounted(() => {
			const file = props.props.file;
			tableName.value = file.name.replace(/.g/g, '');
			const tableNameLower = tableName.value.toLowerCase();
			const env = store.get('env');
			const baseUrl = `${env.HORIZON_API_PUB_HTTP_URL}/v1`;

			getUrl.value = `${baseUrl}/get?table=${tableNameLower}&skip=0&limit=10`;
			searchUrl.value = `${baseUrl}/search?table=${tableNameLower}&skip=0&limit=10`;
			createUrl.value = `${baseUrl}/create?table=${tableNameLower}`;
			updateUrl.value = `${baseUrl}/update?table=${tableNameLower}`;
			deleteUrl.value = `${baseUrl}/delete?table=${tableNameLower}`;
		});

		const copyToClipboard = (section, text) => {
			copy(text);
			showCopiedPopup.value = { [section]: true };
			window.setTimeout(() => {
				showCopiedPopup.value = { [section]: false };
			}, 1500);
		};

		const goToDocLink = (hash) => {
			// // Assuming you have an event bus similar to Vue 2's $bus
			// const eventBus = inject('eventBus');
			// eventBus.emit('container-dialog:close');
			// // Use router.push to navigate
			// const router = useRouter();
			// router.push(`/api#${hash}`);
		};

		return {
			tableName,
			getUrl,
			searchUrl,
			createUrl,
			updateUrl,
			deleteUrl,
			showCopiedPopup,
			copyToClipboard,
			goToDocLink,
		};
	},
});
