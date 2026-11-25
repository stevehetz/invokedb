import { http } from '@/core/http';

/** @param {string} id @param {string} [rest] */
const dashboard_url = (id, rest = '') =>
    http.get_url(`/dashboard/${encodeURIComponent(id)}${rest}`);

// Dashboards (#209): the owner's routes (signed in)
export const dashboard_http = {
    /** `{ dashboards, limits }` */
    async list() {
        return http.get(http.get_url('/dashboard'));
    },

    /** @param {object} body `{ name, tiles }` */
    async create(body) {
        return http.post(http.get_url('/dashboard'), body);
    },

    /** @param {string} id @param {object} changes `{ name }`, `{ tiles }` or both */
    async update(id, changes) {
        return http.put(dashboard_url(id), changes);
    },

    /** @param {string} id */
    async remove(id) {
        return http.delete(dashboard_url(id));
    },

    /** @param {string} id the dashboard with each tile's data, read now */
    async data(id) {
        return http.get(dashboard_url(id, '/data'));
    },

    /** @param {string} id a new share link; the old one stops working */
    async share(id) {
        return http.post(dashboard_url(id, '/share'), {});
    },

    /** @param {string} id revokes the share link */
    async unshare(id) {
        return http.delete(dashboard_url(id, '/share'));
    }
};

// The share link: no sign-in, so no token is sent
export const public_dashboard_http = {
    /** @param {string} token @returns {Promise<any>} */
    async get(token) {
        let res;
        try {
            res = await fetch(
                http.get_url(`/public/dashboard/${encodeURIComponent(token)}`)
            );
        } catch (ex) {
            throw {
                status: 0,
                message: 'Could not reach InvokeDB. Try again.'
            };
        }
        /** @type {any} */
        let body = null;
        try {
            body = await res.json();
        } catch (ex) {
            body = null;
        }
        if (!res.ok) {
            throw {
                status: res.status,
                message: (body && body.message) || 'Something went wrong'
            };
        }
        return body;
    }
};

/** The share link of a dashboard, on this site. @param {string} token */
export function dashboard_link(token) {
    return `${window.location.origin}/d/${encodeURIComponent(token)}`;
}
