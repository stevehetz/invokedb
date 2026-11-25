import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Account } from '@app/core/account/account.entity';
import { OnboardingManager } from '@app/core/onboarding/onboarding.manager';

// Ticks the onboarding checklist's "call the API" step (#143) when an /api/v1 call with the
// account's key succeeds. It never fails or delays the call itself.
@Injectable()
export class OnboardingInterceptor implements NestInterceptor {
    constructor(private readonly onboarding_manager: OnboardingManager) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const user = context.switchToHttp().getRequest().user;
        return next.handle().pipe(
            tap(() => {
                if (!(user instanceof Account) || !user.id) return;
                this.onboarding_manager.record_api_call(user.id).catch(err => {
                    console.error('onboarding: could not record the API call', err);
                });
            })
        );
    }
}
