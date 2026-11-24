import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import env from '@app/env';
import { SsoStateStore } from './sso-state.store';
import { google_identity, sso_callback_url, sso_credentials, SsoIdentity } from './sso-identity';

// Registered even when Google sign-in isn't configured (the strategy needs some client ID to
// construct); SsoGuard answers 404 before it's used in that case.
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
    constructor() {
        const { client_id, client_secret } = sso_credentials('google', env);
        const callbackURL = sso_callback_url('google', env);
        super({
            clientID: client_id || 'not-configured',
            clientSecret: client_secret || 'not-configured',
            callbackURL,
            scope: ['openid', 'email', 'profile'],
            store: new SsoStateStore(callbackURL.startsWith('https:'))
        } as any);
    }

    validate(_access_token: string, _refresh_token: string, profile: any): SsoIdentity {
        return google_identity(profile);
    }
}
