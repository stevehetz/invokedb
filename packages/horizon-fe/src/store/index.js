import Store from './store';

export const store = new Store({
    account: null,
    env: null,
    // The API key made last in this visit, with its secret (#138); memory only
    new_api_key: null
});
