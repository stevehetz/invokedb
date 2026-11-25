import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Request,
    UseGuards,
    HttpException,
    HttpStatus
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DashboardService } from '@app/application/dashboard/dashboard.service';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { RateLimiter, TOO_MANY_REQUESTS_MESSAGE } from '../_rate-limit/rate-limit';
import { DASHBOARD_RATE_LIMITS } from '@app/core/dashboard/dashboard';

// Dashboards (#209), for the signed-in app: build them from chart, table and stat tiles, read
// their tiles' data, and share or stop sharing them by a read-only link
@Controller('dashboard')
@UseGuards(AuthGuard('bearer'))
export class DashboardController {
    constructor(private dashboard_service: DashboardService) {}

    /** `{ dashboards, limits }`. */
    @Get()
    async list(@Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.list(account_id);
    }

    @Get(':id')
    async get(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.get(account_id, id);
    }

    /** The dashboard with each tile's `data` (or `error`), read now. */
    @Get(':id/data')
    async data(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.data(account_id, id);
    }

    /**
     * Body: `{ name, tiles: [{ type: chart|table|stat, title, file_id, view_id, wide,
     * limit (table), agg: count|sum|avg|min|max (stat), value_field (stat) }] }`.
     */
    @Post()
    async create(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.create(account_id, body);
    }

    /** Body: `{ name }`, `{ tiles }` or both. */
    @Put(':id')
    async update(@Param('id') id: string, @Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.update(account_id, id, body);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.remove(account_id, id);
    }

    /** A new share link (`share_token`); the old one stops working. */
    @Post(':id/share')
    async share(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.share(account_id, id);
    }

    /** Revokes the share link. */
    @Delete(':id/share')
    async unshare(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.dashboard_service.unshare(account_id, id);
    }
}

// A dashboard's read-only share link (#209): no sign-in. 404 for a token that was never issued
// or has been revoked or replaced.
@Controller('public/dashboard')
export class PublicDashboardController {
    // `req.ip` is the client's address: main.ts trusts the one proxy in front (Caddy)
    private readonly by_ip = new RateLimiter(
        DASHBOARD_RATE_LIMITS.per_ip,
        DASHBOARD_RATE_LIMITS.window_ms
    );
    private readonly by_dashboard = new RateLimiter(
        DASHBOARD_RATE_LIMITS.per_dashboard,
        DASHBOARD_RATE_LIMITS.window_ms
    );

    constructor(private dashboard_service: DashboardService) {}

    /** `{ name, updated_at, tiles: [{ id, type, title, wide, ..., data, error }] }`. */
    @Get(':token')
    async view(@Param('token') token: string, @Request() req) {
        const ip_ok = this.by_ip.hit(req.ip || 'unknown');
        const dashboard_ok = this.by_dashboard.hit(String(token).slice(0, 64));
        if (!ip_ok || !dashboard_ok) {
            throw new HttpException(TOO_MANY_REQUESTS_MESSAGE, HttpStatus.TOO_MANY_REQUESTS);
        }
        return await this.dashboard_service.public_view(token);
    }
}
