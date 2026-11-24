import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import env from '@app/env';
import { SsoStateStore } from './sso-state.store';
import { github_identity, sso_callback_url, sso_credentials, SsoIdentity } from './sso-identity';

// Registered even when GitHub sign-in isn't configured (the strategy needs some client ID to
// construct); SsoGuard answers 404 before it's used in that case.
@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
    constructor() {
        const { client_id, client_secret } = sso_credentials('github', env);
        const callbackURL = sso_callback_url('github', env);
        super({
            clientID: client_id || 'not-configured',
            clientSecret: client_secret || 'not-configured',
            callbackURL,
            // user:email lets passport-github2 fetch /user/emails; allRawEmails keeps each
            // address's `primary` and `verified` flags (github_identity needs both)
            scope: ['user:email'],
            allRawEmails: true,
            store: new SsoStateStore(callbackURL.startsWith('https:'))
        } as any);
    }

    validate(_access_token: string, _refresh_token: string, profile: any): SsoIdentity {
        return github_identity(profile);
    }
}
