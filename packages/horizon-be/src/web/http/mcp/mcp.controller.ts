import {
    Controller,
    Delete,
    Get,
    HttpException,
    HttpStatus,
    Post,
    Request,
    Res,
    UseGuards,
    UseInterceptors
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { McpService } from '@app/application/mcp/mcp.service';
import { handle_body } from '@app/core/mcp/mcp';
import { api_key_account } from '@app/web/http/_auth/request-account';
import { ApiKeyUsageGuard } from '@app/web/http/external/api-key-usage.guard';
import { OnboardingInterceptor } from '@app/web/http/external/onboarding.interceptor';

const NO_STREAM = 'This MCP server answers each POST with JSON; it has no event stream or sessions';

// The MCP server (#305): AI agents use the account's tables with an API key, like /api/v1
// (the same bearer check, per-key rate limit and request log, onboarding tick). Streamable HTTP,
// stateless: every request is a POST of JSON-RPC answered with JSON (core/mcp/mcp.ts).
@Controller('mcp')
@UseGuards(AuthGuard('bearer'), ApiKeyUsageGuard)
@UseInterceptors(OnboardingInterceptor)
export class McpController {
    constructor(private readonly mcp_service: McpService) {}

    @Post()
    async message(@Request() req, @Res({ passthrough: true }) res) {
        const account = api_key_account(req.user);
        const answer = await handle_body(req.body, this.mcp_service.context(account));
        res.status(answer.status);
        return answer.body;
    }

    // No server-sent event stream to open, and no session to end
    @Get()
    stream() {
        throw new HttpException(NO_STREAM, HttpStatus.METHOD_NOT_ALLOWED);
    }

    @Delete()
    end_session() {
        throw new HttpException(NO_STREAM, HttpStatus.METHOD_NOT_ALLOWED);
    }
}
