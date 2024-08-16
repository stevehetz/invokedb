import HDataGrid from '@/components/h-data-grid/index.vue';

export default {
	name: 'DocContainer',

	props: ['file_directory_id', 'web_file_type', 'file'],

	components: {
		'h-data-grid': HDataGrid,
	},
};
