import cookies from 'js-cookie';
import { store } from '@/store';
import { http } from '@/core/http';

export const account_manager = {
    get_token() {
        // Set by the login / create-account pages (same origin since the site and app merged)
        return cookies.get('token');
    },

    async refresh_account_store() {
        const token = this.get_token();
        const url = http.get_url(`/auth/authorize?token=${token}`);
        const account = await http.get(url);
        store.set('account', account);
    },

    async get_account(token) {
        let account = store.get('account');
        // The site may have stored another session's account (sign-in moves to the app
        // through the router, so the store survives it)
        if (!account || account.token !== token) {
            const url = http.get_url(`/auth/authorize?token=${token}`);
            account = await http.get(url);
            store.set('account', account);
        }
        if (!account) {
            throw new Error('Error retrieving account');
        }

        return account;
    },

    async update_account(account) {
        const url = http.get_url(`/account/update_account/${account.id}`);
        await http.put(url, account);
        store.set('account', account);
    },

    async change_password(passwords) {
        const id = store.get('account').id;
        const url = http.get_url(`/account/change_password/${id}`);
        return await http.put(url, passwords);
    },

    async delete_account(account_id) {
        const url = http.get_url(`/account/delete_account/${account_id}`);
        return await http.put(url);
    },

    // True when the server says the session is over (expired, signed out elsewhere, account
    // deleted): /auth/authorize answers null for it. Throws when the server can't be reached,
    // so a network blip never signs anyone out (#378).
    /** @returns {Promise<boolean>} */
    async session_ended() {
        const token = this.get_token();
        if (!token) return true;
        const url = http.get_url(`/auth/authorize?token=${token}`);
        const account = await http.get(url);
        return !account;
    },

    // Forgets a session the server has already ended (no logout call to make)
    end_local_session() {
        store.set('account', null);
        cookies.remove('token');
    },

    async logout() {
        const account = store.get('account');
        const token = account.token;
        const url = http.get_url(`/auth/logout?token=${token}`);
        await http.get(url);
        store.set('account', null);
        cookies.remove('token');
        return 'logged out';
    }
};
