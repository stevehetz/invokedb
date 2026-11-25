import { HttpException, HttpStatus } from '@nestjs/common';

// Email verification on signup (#132). A new password account starts unverified: it can sign in
// and look around, but can't create tables or use its API key until its owner clicks the link
// sent to the address. Google and GitHub accounts (the provider verified the email) and accounts
// from before #132 are verified.

/** How long a verification link works (the email_verification table's default expiry). */
export const VERIFY_LINK_HOURS = 24;

export const UNVERIFIED_MESSAGE =
    'Confirm your email address first: click the link in the email we sent you, or send a new one from the banner at the top of the app.';

/** The one answer to a signup, whether or not the email already has an account. */
export const SIGNUP_ANSWER = 'success';

/** Only an explicit `true` counts, so a row read without the column is never verified. */
export function is_verified(account: { email_verified?: boolean } | null | undefined): boolean {
    return account?.email_verified === true;
}

/** Throws 403 for an account that hasn't verified its email. */
export function assert_verified(account: { email_verified?: boolean } | null | undefined) {
    if (!is_verified(account)) {
        throw new HttpException(UNVERIFIED_MESSAGE, HttpStatus.FORBIDDEN);
    }
}

/** A table needs a verified account; a folder (type 'dir') doesn't, as it holds no data. */
export function creating_needs_verified_email(file_directory: { type?: string }): boolean {
    return file_directory?.type !== 'dir';
}

/** The page the verification email links to (on the public site). */
export function verify_email_url(site_url: string, token: string): string {
    return `${site_url}/verify-email?token=${encodeURIComponent(token)}`;
}

/** The API key, but only for a verified account (an unverified one doesn't have one to use yet). */
export function visible_api_key(account: { email_verified?: boolean; api_key?: string }) {
    return is_verified(account) ? account.api_key : null;
}
