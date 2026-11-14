import HttpBase from '@/network/http/http-base';
import { store } from '@/store';

export default class SubscriptionHttp extends HttpBase {
    async get_stripe_pk() {
        const url = store.get('env').HORIZON_BE_PUB_HTTP_URL + '/stripe/pk';
        return await this.http_get(url);
    }
}
