import { request } from './request';
import file_upload from './file-upload';
import { store } from '@/store';

export const http = {
    get_url(url_path) {
        return `${store.get('env').HORIZON_BE_PUB_HTTP_URL}${url_path}`;
    },

    get_prc_url(url_path) {
        return `${store.get('env').HORIZON_PRC_PUB_HTTP_URL}${url_path}`;
    },

    get_fs_url(url_path) {
        return `${store.get('env').HORIZON_FS_PUB_HTTP_URL}${url_path}`;
    },

    get_token() {
        let account = store.get('account');
        if (!account || !account.token) return null;
        return account.token;
    },

    query_from_page_params(params) {
        params = params || {};
        let { skip, limit, sort_by, sort_dir } = params;

        if (skip === undefined || limit === undefined) return '';

        let url = `?skip=${skip}&limit=${limit}`;

        if (sort_by && sort_dir)
            url += `&sort_by=${sort_by}&sort_dir=${sort_dir}`;

        return url;
    },

    get(path) {
        return request('GET', path, this.get_token());
    },

    async put(path, data, callback) {
        const res = await request('PUT', path, this.get_token(), data);
        if (callback) callback(res);
        return res;
    },

    async post(path, data, callback) {
        const res = await request('POST', path, this.get_token(), data);
        if (callback) callback(res);
        return res;
    },

    delete(path, data) {
        // TODO
        return path + data;
    },

    file_upload(path, file_ctx) {
        const full_url = path;
        file_ctx.headers = { Authorization: `BEARER ${this.get_token()}` };
        return file_upload(full_url, file_ctx);
    }
};
