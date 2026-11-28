import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Session } from '@app/core/session/session.entity';
import { Account } from '@app/core/account/account.entity';
import { demo_off_error, is_demo_account } from '@app/core/demo/demo';
import { DemoService } from '@app/application/demo/demo.service';

/** Whether a request changes something: everything but GET and HEAD. */
export function is_write(method: unknown) {
    const m = String(method || '').toUpperCase();
    return m !== 'GET' && m !== 'HEAD';
}

/**
 * The features that are off in the no-signup demo (#333): API keys and MCP, webhooks, URL
 * imports and syncs, data export, two-factor, billing and deleting the account (it goes by
 * itself). A demo account's writes to them are refused with 403 `demo_account`; reads answer
 * as usual (there's nothing to list). Use after the bearer guard:
 * `@UseGuards(AuthGuard('bearer'), NoDemoGuard)`.
 */
@Injectable()
export class NoDemoGuard implements CanActivate {
    constructor(private readonly demo: DemoService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest();
        if (!is_write(req.method)) return true;
        const user = req.user;
        if (user instanceof Account) {
            if (is_demo_account(user)) throw demo_off_error();
        } else if (user instanceof Session) {
            if (await this.demo.is_demo(user.account_id)) throw demo_off_error();
        }
        return true;
    }
}
