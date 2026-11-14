import $ from 'jquery';
import { store } from '@/store';

export default class HttpBase {
    get_token() {
        let account = store.get('account');
        if (!account || !account.token) return null;
        return account.token;
    }

    http_get(path) {
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
                    if (res.status >= 400) reject(res);
                    resolve(res);
                })
                .fail(res => {
                    reject(res.responseJSON);
                });
        });
    }

    http_put(path, data, callback) {
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
                    if (callback) callback(res);
                    if (res.status >= 400) reject(res);
                    resolve(res);
                })
                .fail(res => {
                    reject(res.responseJSON);
                });
        });
    }

    http_post(path, data, callback) {
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
                    if (callback) callback(res);
                    if (res.status >= 400) reject(res);
                    resolve(res);
                })
                .fail(res => {
                    reject(res.responseJSON);
                });
        });
    }

    http_delete(path, data) {
        // TODO
        return path + data;
    }
}
