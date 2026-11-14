import HttpBase from '@/network/http/http-base';
import { store } from '@/store';

export default class AccountHttp extends HttpBase {
    async login(data) {
        const url = store.get('env').HORIZON_BE_PUB_HTTP_URL + '/auth/login';
        return await this.http_post(`${url}`, data);
    }

    async authorize(token) {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL +
            `/auth/authorize?token=${token}`;
        return await this.http_get(`${url}`);
    }

    async reset_password(email) {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL + '/auth/reset-password';
        return await this.http_get(`${url}?email=${email}`);
    }

    async create_account(data) {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL + '/auth/create-account';
        return await this.http_post(`${url}`, data);
    }

    async change_password(data) {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL + '/auth/change-password';
        return await this.http_post(`${url}`, data);
    }

    async confirm_reset_token(token) {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL +
            `/auth/confirm-reset-token?token=${token}`;
        return await this.http_get(`${url}`);
    }
}
