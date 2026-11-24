import { http } from '@/core/http';

export const support_http = {
    request(data) {
        return http.post(http.get_url('/support/request'), data);
    }
};
