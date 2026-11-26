import { Body, Controller, Delete, Get, Put, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsageService } from '@app/application/plan/usage.service';
import { PlanStateService } from '@app/application/plan/plan-state.service';
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

// Test only (#184): the smoke test puts an account HORIZON_TEST_PLANS lists on another plan, as
// a downgrade would, to check the read-only state. 404 unless HORIZON_TEST_PLANS is set (never
// in production) and lists the caller.
@Controller('test-plan')
@UseGuards(AuthGuard('bearer'))
export class TestPlanController {
    constructor(private readonly plan_state_service: PlanStateService) {}

    // Body: `{ plan: 'FREE' | 'STARTER' | 'PRO', caps? }`, as an entry of HORIZON_TEST_PLANS
    @Put()
    async set(@Body() body, @Request() req) {
        return await this.plan_state_service.set_test_plan(
            session_account_id(req.user),
            body || {}
        );
    }

    // Back to the plan HORIZON_TEST_PLANS lists
    @Delete()
    async reset(@Request() req) {
        return await this.plan_state_service.set_test_plan(session_account_id(req.user), null);
    }
}
