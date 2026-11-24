// @ts-nocheck: not type-checked yet
import HDataGrid from '@/components/h-data-grid/index';

export default {
    name: 'DocContainer',

    props: ['file_directory_id', 'web_file_type', 'file'],

    components: {
        'h-data-grid': HDataGrid
    }
};
