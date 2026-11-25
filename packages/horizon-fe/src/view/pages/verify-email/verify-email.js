import { auth_http } from '@/core/context/account/auth-http';
import { account_manager } from '@/core/context/account/account-manager';
import { APP_PATH } from '@/router';

// The link in the verification email (#132): /verify-email?token=…
export default {
    name: 'VerifyEmail',

    data() {
        return {
            // 'checking', 'done' or 'failed'
            state: 'checking',
            message: '',
            app_path: APP_PATH
        };
    },

    async mounted() {
        const token = new URLSearchParams(window.location.search).get('token');
        try {
            if (!token) throw new Error('This link is missing its token.');
            await auth_http.verify_email(token);
            this.state = 'done';
            // If this browser is signed in, the stored account still says "unverified"
            // and has no API key: fetch it again
            if (account_manager.get_token()) {
                await account_manager.refresh_account_store().catch(() => {});
            }
        } catch (ex) {
            this.state = 'failed';
            this.message =
                (ex && ex.message) || 'This link is invalid or has expired.';
        }
    }
};
