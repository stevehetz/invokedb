import cookies from 'js-cookie';
import { store } from '@/store';
import { http } from '@/core/http';

export const account_manager = {
    get_token() {
        // Check url param for new token
        let url_params = new URLSearchParams(window.location.search);
        let token = url_params.get('token');

        // If token from url, save to cookie
        if (token) cookies.set('token', token);
        // Token not passed by url, check cookie
        else token = cookies.get('token');

        return token;
    },

    async refresh_account_store() {
        const token = this.get_token();
        const url = http.get_url(`/auth/authorize?token=${token}`);
        const account = await http.get(url);
        store.set('account', account);
    },

    async get_account(token) {
        let account = store.get('account');
        if (!account) {
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
