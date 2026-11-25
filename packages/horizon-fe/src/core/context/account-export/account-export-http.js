import { http } from '@/core/http';

// Data export of the account (#215): the backend's job processor writes a zip of every table
// and the forms, views and webhooks settings; the link works for 24 hours, with this session.
export const account_export_http = {
    /** `{ export }`: the newest export, or `{ export: null }` */
    async status() {
        return http.get(http.get_url('/account-export'));
    },

    /** Asks for a new export. `{ export }` */
    async request() {
        return http.post(http.get_url('/account-export'), {});
    },

    /**
     * Downloads a ready export and saves it. The route needs the session's token, so it's
     * fetched here (a plain link can't send it) and handed to the browser as a file.
     * @param {string} id
     * @param {string} file_name
     */
    async download(id, file_name) {
        const url = http.get_url(
            `/account-export/${encodeURIComponent(id)}/download`
        );
        const res = await fetch(url, {
            headers: { Authorization: `BEARER ${http.get_token()}` }
        });
        if (!res.ok) {
            let body;
            try {
                body = await res.json();
            } catch (ex) {
                body = undefined;
            }
            throw body || { status: res.status };
        }
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
};
