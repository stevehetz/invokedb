import { http } from '@/core/http';

// The plans and an account's use of them (#183). The backend's plan constant
// (core/plan/plans.ts) is the one source of every cap: the pricing page and the Account page
// only show what these answer.
export const plan_http = {
    /** The signed-in account's plan, each cap and how much of it is used */
    async usage() {
        return http.get(http.get_url('/usage'));
    },

    /** The plans, public (no token): `{ plans, server_max_upload_bytes }` */
    async plans() {
        const res = await fetch(http.get_url('/plans'));
        if (!res.ok)
            throw { status: res.status, message: 'Could not load the plans' };
        return res.json();
    }
};
