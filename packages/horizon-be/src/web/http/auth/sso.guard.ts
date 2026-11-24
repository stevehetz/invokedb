import { ExecutionContext, Injectable, NotFoundException, Type, mixin } from '@nestjs/common';
import { AuthGuard, IAuthGuard } from '@nestjs/passport';
import env from '@app/env';
import { SsoProvider, sso_enabled } from '@app/application/auth/sso/sso-identity';

/**
 * Runs the Google or GitHub passport strategy: on /auth/<provider> it redirects to the
 * provider, and on the callback it sets `req.user` to the SsoIdentity, or to `{ sso_failed }`
 * when the user cancelled or the sign-in failed, so the controller can redirect back to the
 * login page instead of answering with JSON. 404 when the provider isn't configured.
 */
export function SsoGuard(provider: SsoProvider): Type<IAuthGuard> {
    @Injectable()
    class SsoGuardMixin extends AuthGuard(provider) {
        async canActivate(context: ExecutionContext): Promise<boolean> {
            if (!sso_enabled(provider, env)) {
                throw new NotFoundException(`${provider} sign-in is not configured`);
            }
            return (await super.canActivate(context)) as boolean;
        }

        getAuthenticateOptions() {
            return { session: false };
        }

        handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
            if (user && !err) return user;
            const req = context.switchToHttp().getRequest();
            const cancelled = req?.query?.error === 'access_denied';
            return { sso_failed: cancelled ? 'cancelled' : 'failed', reason: err || info };
        }
    }
    return mixin(SsoGuardMixin);
}
