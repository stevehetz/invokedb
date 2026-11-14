import HttpBase from '@/network/http/http-base';
import { store } from '@/store';

export default class SubscriptionHttp extends HttpBase {
    async get_plan_tiers() {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL +
            '/subscription/plan-tiers';
        return await this.http_get(`${url}`);
    }

    async get_billing_portal(data) {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL +
            '/subscription/billing-portal';
        return await this.http_post(`${url}`, data);
    }

    async create(data) {
        const url =
            store.get('env').HORIZON_BE_PUB_HTTP_URL + '/subscription/create';
        return await this.http_post(`${url}`, data);
    }
}
