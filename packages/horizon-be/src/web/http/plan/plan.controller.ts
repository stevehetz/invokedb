import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsageService } from '@app/application/plan/usage.service';
import { SERVER_MAX_UPLOAD_BYTES, public_plans } from '@app/core/plan/plans';
import { session_account_id } from '@app/web/http/_auth/request-account';

// The plans (#183), public: the pricing page is built from them, so it can't disagree with
// what the backend enforces
@Controller('plans')
export class PlanController {
    @Get()
    plans() {
        return { plans: public_plans(), server_max_upload_bytes: SERVER_MAX_UPLOAD_BYTES };
    }
}

// The signed-in account's use of its plan's caps (#183), for the Account page. An API key
// can't read it.
@Controller('usage')
@UseGuards(AuthGuard('bearer'))
export class UsageController {
    constructor(private readonly usage_service: UsageService) {}

    @Get()
    async usage(@Request() req) {
        return await this.usage_service.usage(session_account_id(req.user));
    }
}
