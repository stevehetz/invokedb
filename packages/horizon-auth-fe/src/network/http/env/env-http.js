import HttpBase from '@/network/http/http-base';

export default class EnvHttp extends HttpBase {
    async get() {
        const date = new Date();
        let env = await this.http_get(`/env.txt?${date.getTime()}`);
        env = JSON.parse(env);
        return env;
    }
}
