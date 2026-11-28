// The no-signup demo (#333): GET /auth/authorize answers `demo: { expires_at }` for a demo
// account (null for any other). Some features are off in it; the backend refuses them with
// 403 `demo_account`, and the app hides them behind components/demo-off.
import { store } from '@/store';
import { account_manager } from '@/core/context/account/account-manager';

/**
 * Whether an account (the store's, by default) is a demo account.
 * @param {any} [account]
 * @returns {boolean}
 */
export function is_demo_account(account = store.get('account')) {
    return !!(account && account.demo);
}

/**
 * Signing up from the demo starts a fresh account: the demo is signed out first, with a full
 * page load like logging out, so nothing of it stays in memory. Its tables aren't carried over.
 */
export async function sign_up_from_demo() {
    try {
        await account_manager.logout();
    } catch (ex) {
        // Signed out here anyway: the cookie is gone below with the page
        console.log(ex);
    }
    window.location.href = '/create-account';
}
