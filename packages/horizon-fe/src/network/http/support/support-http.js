import HttpBase from '@/network/http/http-base';
import { store } from '@/store';

export default class SupportHttp extends HttpBase {
    async request(data) {
        const url = store.get('env').HORIZON_BE_PUB_HTTP_URL + '/support/request';
        return await this.http_post(`${url}`, data);
    }
}
