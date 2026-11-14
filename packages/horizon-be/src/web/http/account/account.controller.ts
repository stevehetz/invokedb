import { Controller, Post, Put, Body, Param } from '@nestjs/common';
import { AccountService } from '@app/application/account/account.service';
import { AccountUpdateDto } from '@app/application/account/dto/account-update.dto';
import { AccountPassChangeDto } from '@app/application/account/dto/account-pass-change.dto';
import { PageParamsDto } from '@app/web/http/_paging/page-params.dto';

@Controller('account')
export class AccountController {
    constructor(private readonly account_service: AccountService) {}

    @Post()
    async get_all(@Body() params: PageParamsDto) {
        const res = await this.account_service.get_all(params);
        return res;
    }

    @Put('update_account/:account_id')
    async update_account(@Param('account_id') account_id, @Body() update_dto: AccountUpdateDto) {
        return await this.account_service.update(account_id, update_dto);
    }

    @Put('change_password/:account_id')
    async change_account_password(
        @Param('account_id') account_id,
        @Body() change_pass: AccountPassChangeDto
    ) {
        return await this.account_service.change_password(account_id, change_pass);
    }

    @Put('delete_account/:account_id')
    async delete_account(@Param('account_id') account_id) {
        return await this.account_service.delete_account(account_id);
    }
}
