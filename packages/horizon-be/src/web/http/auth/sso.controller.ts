import { Controller, Get, Request, Response, UseGuards } from '@nestjs/common';
import { AuthService } from '@app/application/auth/auth.service';
import {
    SSO_PROVIDERS,
    SsoError,
    sso_enabled,
    sso_error_url,
    sso_success_url
} from '@app/application/auth/sso/sso-identity';
import { SsoGuard } from './sso.guard';
import logger from '@app/logger';
import env from '@app/env';

/**
 * Google and GitHub sign-in. The login page sends the browser to /auth/<provider>?nonce=…,
 * which redirects to the provider; the provider redirects back to /auth/<provider>/callback,
 * which signs in (AuthService.sso_login) and redirects to the login page with the session token
 * and the nonce in the URL fragment, or with `?sso_error=<code>`.
 */
@Controller('auth')
export class SsoController {
    constructor(private readonly auth_service: AuthService) {}

    // Which sign-in buttons the login and signup pages show
    @Get('sso-providers')
    providers() {
        return Object.fromEntries(SSO_PROVIDERS.map(p => [p, sso_enabled(p, env)]));
    }

    // The guard redirects to the provider
    @Get('google')
    @UseGuards(SsoGuard('google'))
    google() {}

    @Get('google/callback')
    @UseGuards(SsoGuard('google'))
    async google_callback(@Request() req, @Response() res) {
        await this.finish(req, res);
    }

    @Get('github')
    @UseGuards(SsoGuard('github'))
    github() {}

    @Get('github/callback')
    @UseGuards(SsoGuard('github'))
    async github_callback(@Request() req, @Response() res) {
        await this.finish(req, res);
    }

    private async finish(req, res) {
        const fe_url = env.HORIZON_FE_PUB_HTTP_URL;
        const identity = req.user;

        if (!identity || identity.sso_failed) {
            const reason = identity?.reason?.message || identity?.reason || 'no profile';
            logger.info(`SSO sign-in did not complete: ${reason}`);
            return res.redirect(sso_error_url(fe_url, identity?.sso_failed || 'failed'));
        }

        try {
            const session = await this.auth_service.sso_login(identity);
            return res.redirect(sso_success_url(fe_url, session.token, req.sso_nonce || ''));
        } catch (ex) {
            if (ex instanceof SsoError) {
                logger.info(`SSO sign-in refused (${identity.provider}): ${ex.code}`);
                return res.redirect(sso_error_url(fe_url, ex.code));
            }
            logger.error(`SSO sign-in failed (${identity.provider}): ${ex?.message || ex}`);
            return res.redirect(sso_error_url(fe_url, 'failed'));
        }
    }
}
