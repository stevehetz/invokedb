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
        return new Promise((resolve, reject) => {
            $.ajax({
                method: 'GET',
                url: path,
                contentType: 'application/json',
                beforeSend: xhr => {
                    xhr.setRequestHeader(
                        'Authorization',
                        `BEARER ${this.get_token()}`
                    );
                }
            })
                .done(res => {
                    if (res.status >= 400) return reject(res);
                    resolve(res);
                })
                .fail(res => {
                    reject(res.responseJSON);
                });
        });
    },

    put(path, data, callback) {
        return new Promise((resolve, reject) => {
            $.ajax({
                method: 'PUT',
                url: path,
                contentType: 'application/json',
                data: JSON.stringify(data),
                beforeSend: xhr => {
                    xhr.setRequestHeader(
                        'Authorization',
                        `BEARER ${this.get_token()}`
                    );
                }
            })
                .done(res => {
                    if (res.status >= 400) return reject(res);
                    if (callback) callback(res);
                    resolve(res);
                })
                .fail(res => {
                    reject(res.responseJSON);
                });
        });
    },

    post(path, data, callback) {
        return new Promise((resolve, reject) => {
            $.ajax({
                method: 'POST',
                url: path,
                contentType: 'application/json',
                data: JSON.stringify(data),
                beforeSend: xhr => {
                    xhr.setRequestHeader(
                        'Authorization',
                        `BEARER ${this.get_token()}`
                    );
                }
            })
                .done(res => {
                    if (res.status >= 400) return reject(res);
                    if (callback) callback(res);
                    resolve(res);
                })
                .fail(res => {
                    reject(res.responseJSON);
                });
        });
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
