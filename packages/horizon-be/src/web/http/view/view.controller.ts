import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    Query,
    Request,
    UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ViewService } from '@app/application/view/view.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// Saved views of a table (#146), for the signed-in app: save, rename, change and delete a
// table's views, and read a kanban view's board, a chart view's points, a calendar view's
// events and a map view's points (#211)
@Controller('view')
@UseGuards(AuthGuard('bearer'))
export class ViewController {
    constructor(private view_service: ViewService) {}

    /** `?table=<id>`: `{ views, columns, limits }`. */
    @Get()
    async list(@Query('table') table: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.list(account_id, table);
    }

    @Get(':id')
    async get(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.get(account_id, id);
    }

    /** `{ group_field, groups: [{ value, count, rows }], truncated, columns }`. */
    @Get(':id/kanban')
    async kanban(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.kanban(account_id, id);
    }

    /** `{ kind, group_field, agg, value_field, points: [{ label, value }], truncated }`. */
    @Get(':id/chart')
    async chart(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.chart(account_id, id);
    }

    /**
     * `?from=YYYY-MM-DD&to=YYYY-MM-DD` (to not included; the current month without them):
     * `{ date_field, title_field, from, to, events: [{ _id, date, time, title }], truncated }`.
     */
    @Get(':id/calendar')
    async calendar(
        @Param('id') id: string,
        @Query('from') from: string,
        @Query('to') to: string,
        @Request() req
    ) {
        const account_id = session_account_id(req.user);
        return await this.view_service.calendar(account_id, id, from, to);
    }

    /**
     * `{ lat_field, lng_field, label_field, points: [{ _id, lat, lng, label }], truncated,
     * missing }`.
     */
    @Get(':id/map')
    async map(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.map(account_id, id);
    }

    /**
     * Body: `{ file_id, name, type: grid|kanban|chart|calendar|map, filters: [{ field, type,
     * value }], sort: { field, dir } | null, hidden_fields: [field], kanban: { group_field },
     * chart: { kind: bar|line|pie, group_field, agg: count|sum, value_field },
     * calendar: { date_field, title_field }, map: { lat_field, lng_field, label_field } }`.
     */
    @Post()
    async create(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.create(account_id, body);
    }

    /** Body: any of the settings; `{ name }` renames the view. */
    @Put(':id')
    async update(@Param('id') id: string, @Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.update(account_id, id, body);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.view_service.remove(account_id, id);
    }
}
