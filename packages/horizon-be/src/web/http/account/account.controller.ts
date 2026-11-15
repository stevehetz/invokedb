import {
    Controller,
    Put,
    Body,
    Param,
    Request,
    UseGuards,
    UnauthorizedException
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AccountService } from '@app/application/account/account.service';
import { AccountUpdateDto } from '@app/application/account/dto/account-update.dto';
import { AccountPassChangeDto } from '@app/application/account/dto/account-pass-change.dto';
import { session_account_id } from '@app/web/http/_auth/request-account';

// The routes keep `:account_id` in the path because the frontend sends it, but they only ever
// act on the signed-in caller's own account; any other id is rejected.
@Controller('account')
@UseGuards(AuthGuard('bearer'))
export class AccountController {
    constructor(private readonly account_service: AccountService) {}

    @Put('update_account/:account_id')
    async update_account(
        @Param('account_id') account_id,
        @Body() update_dto: AccountUpdateDto,
        @Request() req
    ) {
        const id = own_account_id(req, account_id);
        // Only the profile fields; billing fields are set by the subscription flow.
        const { first_name, last_name } = update_dto;
        return await this.account_service.update(id, { first_name, last_name } as AccountUpdateDto);
    }

    @Put('change_password/:account_id')
    async change_account_password(
        @Param('account_id') account_id,
        @Body() change_pass: AccountPassChangeDto,
        @Request() req
    ) {
        return await this.account_service.change_password(
            own_account_id(req, account_id),
            change_pass
        );
    }

    @Put('delete_account/:account_id')
    async delete_account(@Param('account_id') account_id, @Request() req) {
        return await this.account_service.delete_account(own_account_id(req, account_id));
    }
}

function own_account_id(req, path_account_id): number {
    const account_id = session_account_id(req.user);
    if (Number(path_account_id) !== account_id) {
        throw new UnauthorizedException();
    }
    return account_id;
}
