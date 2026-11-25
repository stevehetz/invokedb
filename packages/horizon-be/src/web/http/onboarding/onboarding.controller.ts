import {
    BadRequestException,
    Controller,
    Get,
    Param,
    Put,
    Request,
    UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OnboardingService } from '@app/application/onboarding/onboarding.service';
import { markable_step, MARKABLE_STEPS } from '@app/core/onboarding/onboarding';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { public_api_base_url } from '@app/web/http/public-api-url';

// The signed-in account's onboarding checklist (#143). There's no account id in the path: each
// route only reads or changes the caller's own checklist, and only with a login session.
@Controller('onboarding')
@UseGuards(AuthGuard('bearer'))
export class OnboardingController {
    constructor(private readonly onboarding_service: OnboardingService) {}

    @Get()
    async get(@Request() req) {
        return await this.onboarding_service.get(
            session_account_id(req.user),
            public_api_base_url(req)
        );
    }

    @Put('steps/:step')
    async mark(@Param('step') step, @Request() req) {
        const account_id = session_account_id(req.user);
        const s = markable_step(step);
        if (!s) {
            throw new BadRequestException(`step must be one of: ${MARKABLE_STEPS.join(', ')}`);
        }
        return await this.onboarding_service.mark(account_id, s, public_api_base_url(req));
    }

    @Put('dismiss')
    async dismiss(@Request() req) {
        return await this.onboarding_service.dismiss(
            session_account_id(req.user),
            public_api_base_url(req)
        );
    }
}
