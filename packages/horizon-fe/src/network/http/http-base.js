import { request } from '@/core/http/request';
import { store } from '@/store';

export default class HttpBase {
    get_token() {
        let account = store.get('account');
        if (!account || !account.token) return null;
        return account.token;
    }

    http_get(path) {
        return request('GET', path, this.get_token());
    }

    async http_put(path, data, callback) {
        const res = await request('PUT', path, this.get_token(), data);
        if (callback) callback(res);
        return res;
    }

    async http_post(path, data, callback) {
        const res = await request('POST', path, this.get_token(), data);
        if (callback) callback(res);
        return res;
    }

    http_delete(path, data) {
        // TODO
        return path + data;
    }
}
