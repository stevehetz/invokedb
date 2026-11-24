import * as crypto from 'crypto';
import { valid_nonce } from './sso-identity';

const COOKIE = 'horizon_sso_state';
const MAX_AGE_MS = 10 * 60 * 1000;

function read_cookie(req: any, name: string): string | null {
    const header: string = req?.headers?.cookie || '';
    for (const part of header.split(';')) {
        const i = part.indexOf('=');
        if (i > -1 && part.slice(0, i).trim() === name) {
            try {
                return decodeURIComponent(part.slice(i + 1).trim());
            } catch {
                return null;
            }
        }
    }
    return null;
}

function same(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * OAuth `state` for passport-oauth2 without server sessions (the backend has none): the random
 * state goes in a short-lived httpOnly cookie on the API host, and the callback must bring back
 * the same value (CSRF protection for the callback). The cookie also carries the frontend's
 * nonce, which the callback hands back to the frontend with the token (`req.sso_nonce`).
 *
 * SameSite=Lax is enough: the provider's redirect to the callback is a top-level GET.
 */
export class SsoStateStore {
    constructor(private readonly secure: boolean) {}

    // passport-oauth2 picks the signature by arity: store(req, meta, cb)
    store(req: any, _meta: any, cb: (err: any, state?: string) => void) {
        const state = crypto.randomBytes(24).toString('base64url');
        const nonce = valid_nonce(req?.query?.nonce) ? req.query.nonce : '';
        req.res.cookie(COOKIE, `${state}.${nonce}`, {
            httpOnly: true,
            secure: this.secure,
            sameSite: 'lax',
            path: '/auth',
            maxAge: MAX_AGE_MS
        });
        cb(null, state);
    }

    // verify(req, state, cb)
    verify(req: any, state: unknown, cb: (err: any, ok: boolean, info?: any) => void) {
        const saved = read_cookie(req, COOKIE) || '';
        req.res.clearCookie(COOKIE, { path: '/auth' });

        const dot = saved.indexOf('.');
        const saved_state = dot > -1 ? saved.slice(0, dot) : '';
        const nonce = dot > -1 ? saved.slice(dot + 1) : '';

        if (typeof state !== 'string' || !saved_state || !same(state, saved_state)) {
            return cb(null, false, { message: 'Invalid sign-in state' });
        }
        req.sso_nonce = valid_nonce(nonce) ? nonce : '';
        cb(null, true);
    }
}
