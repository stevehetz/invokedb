import { http } from '@/core/http';

export const web_file_http = {
    async get_new_column(id) {
        let url = http.get_url(`/web-file/${id}/get_new_column`);
        return http.get(url);
    },

    async get_by_id(id, type, page_params) {
        type = type.replace('-', '_');

        let url = http.get_url(`/web-file/${type}/${id}`);
        url += http.query_from_page_params(page_params);

        let filters = page_params ? page_params.filters : undefined;

        return http.post(url, filters);
    },

    async batch_create(type, file_directory_id, payload) {
        type = type.replace('-', '_');
        const url = http.get_url(
            `/web-file/batch_create/${type}/${file_directory_id}`
        );

        return http.post(url, payload);
    },

    async update(type, file_directory_id, payload, callback) {
        type = type.replace('-', '_');
        const id = payload.web_doc_record._id;
        const url = http.get_url(
            `/web-file/${id}/${type}/${file_directory_id}`
        );

        let data = {};
        if (typeof payload.web_doc_record !== 'string')
            data = payload.web_doc_record;

        return http.put(url, data, callback);
    },

    async batch_update(type, file_directory_id, use_job, payload) {
        type = type.replace('-', '_');

        let url;

        if (use_job) {
            url = http.get_url(
                `/web-file/batch_update_job/${type}/${file_directory_id}`
            );
        } else {
            url = http.get_url(
                `/web-file/batch_update/${type}/${file_directory_id}`
            );
        }

        return http.put(url, payload);
    },

    async batch_delete(type, file_directory_id, payload) {
        type = type.replace('-', '_');
        const url = http.get_url(
            `/web-file/batch_delete/${type}/${file_directory_id}`
        );

        let ids = payload.ids;

        return http.post(url, ids, _id => {
            if (payload.callback) payload.callback(_id);
        });
    },

    async file_upload(file_ctx) {
        const url = http.get_fs_url(`/web-file/file_upload`);
        return http.file_upload(url, file_ctx);
    }
};
