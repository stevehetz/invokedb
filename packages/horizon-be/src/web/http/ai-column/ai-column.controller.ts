import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Query,
    Request,
    UseGuards
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AiColumnService } from '@app/application/ai-column/ai-column.service';
import { session_account_id } from '@app/web/http/_auth/request-account';

// AI columns (#205), for the signed-in app: make a column an AI column (a prompt over other
// columns of the row), see what filling it would use, fill it, or make it an ordinary column
// again. The cells are computed by the processor role.
@Controller('ai-column')
@UseGuards(AuthGuard('bearer'))
export class AiColumnController {
    constructor(private ai_column_service: AiColumnService) {}

    /** `?table=<id>`: `{ columns: [{ field, prompt, inputs, auto, state, note... }], limits }`. */
    @Get()
    async list(@Query('table') table: string, @Request() req) {
        return await this.ai_column_service.list(session_account_id(req.user), table);
    }

    /** Body: `{ table, field, prompt, inputs: [field] }`. Answers `{ column }`. */
    @Put()
    async save(@Body() body, @Request() req) {
        return await this.ai_column_service.save(session_account_id(req.user), body);
    }

    /** `{ rows, empty, left, limit, available }`: the AI rows a fill would use. */
    @Get(':table/:field/estimate')
    async estimate(@Param('table') table: string, @Param('field') field: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ai_column_service.estimate(account_id, table, field);
    }

    /** Fills the column's out-of-date cells, then keeps them up to date. `{ column }`. */
    @Post(':table/:field/fill')
    async fill(@Param('table') table: string, @Param('field') field: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ai_column_service.fill(account_id, table, field);
    }

    @Delete(':table/:field')
    async remove(@Param('table') table: string, @Param('field') field: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.ai_column_service.remove(account_id, table, field);
    }
}
