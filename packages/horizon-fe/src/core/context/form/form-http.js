import { http } from '@/core/http';

// Shareable forms (#145): the owner's routes (signed in)
export const form_http = {
    /** @param {number} table that table's forms, and the columns a form can ask */
    async list(table) {
        return http.get(http.get_url(`/form?table=${table}`));
    },

    /** @param {object} body `{ file_id, title, fields, ... }` */
    async create(body) {
        return http.post(http.get_url('/form'), body);
    },

    /** @param {string} id @param {object} changes */
    async update(id, changes) {
        return http.put(
            http.get_url(`/form/${encodeURIComponent(id)}`),
            changes
        );
    },

    /** @param {string} id */
    async remove(id) {
        return http.delete(http.get_url(`/form/${encodeURIComponent(id)}`));
    }
};

// A form's public link: no sign-in, so no token is sent
/** @returns {Promise<any>} */
async function public_request(method, url, data) {
    /** @type {RequestInit} */
    const options = { method, headers: {} };
    if (data !== undefined) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(data);
    }
    let res;
    try {
        res = await fetch(url, options);
    } catch (ex) {
        throw { status: 0, message: 'Could not reach InvokeDB. Try again.' };
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
            message: (body && body.message) || 'Something went wrong',
            errors: (body && body.errors) || {}
        };
    }
    return body;
}

export const public_form_http = {
    /** @param {string} id */
    async get(id) {
        return public_request(
            'GET',
            http.get_url(`/public/form/${encodeURIComponent(id)}`)
        );
    },

    /** @param {string} id @param {object} body `{ values, website }` */
    async submit(id, body) {
        return public_request(
            'POST',
            http.get_url(`/public/form/${encodeURIComponent(id)}/submit`),
            body
        );
    }
};

/** The public link of a form, on this site. @param {string} id */
export function form_link(id) {
    return `${window.location.origin}/f/${encodeURIComponent(id)}`;
}

/** An iframe that shows the form on another site. @param {string} id */
export function form_embed(id) {
    return (
        `<iframe src="${form_link(id)}?embed=1" title="InvokeDB form" ` +
        'width="100%" height="640" style="border:0;max-width:640px" ' +
        'loading="lazy"></iframe>'
    );
}
