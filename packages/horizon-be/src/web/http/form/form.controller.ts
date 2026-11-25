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
    UseGuards,
    HttpCode,
    HttpStatus
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FormService } from '@app/application/form/form.service';
import { session_account_id } from '@app/web/http/_auth/request-account';
import { FormRateLimit } from './form-rate-limit';

// Shareable forms (#145), for the signed-in app: create, change, close and delete a table's forms
@Controller('form')
@UseGuards(AuthGuard('bearer'))
export class FormController {
    constructor(private form_service: FormService) {}

    /** `{ forms, limits }`; `?table=<id>`: only that table's, plus its `columns`. */
    @Get()
    async list(@Query('table') table: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.form_service.list(account_id, table);
    }

    @Get(':id')
    async get(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.form_service.get(account_id, id);
    }

    /**
     * Body: `{ file_id, title, fields: [{ field, label?, required?, help? }], description?,
     * submit_label?, thank_you?, redirect_url?, open? }`.
     */
    @Post()
    async create(@Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.form_service.create(account_id, body);
    }

    /** Body: any of the settings; `{ open: false }` closes the form. */
    @Put(':id')
    async update(@Param('id') id: string, @Body() body, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.form_service.update(account_id, id, body);
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Request() req) {
        const account_id = session_account_id(req.user);
        return await this.form_service.remove(account_id, id);
    }
}

// A form's public link (#145): no sign-in. 404 for a form that doesn't exist (or whose table
// was deleted), 410 for a closed one.
@Controller('public/form')
export class PublicFormController {
    // `req.ip` is the client's address: main.ts trusts the one proxy in front (Caddy)
    private readonly limit = new FormRateLimit();

    constructor(private form_service: FormService) {}

    /** The form's title, description and questions, each with its column's type. */
    @Get(':id')
    async view(@Param('id') id: string) {
        return await this.form_service.public_view(id);
    }

    /** Body: `{ values: { <key>: answer }, website: '' }`. `{ ok, thank_you, redirect_url }`. */
    @Post(':id/submit')
    @HttpCode(HttpStatus.OK)
    async submit(@Param('id') id: string, @Body() body, @Request() req) {
        this.limit.check(id, req.ip);
        return await this.form_service.submit(id, body);
    }
}
