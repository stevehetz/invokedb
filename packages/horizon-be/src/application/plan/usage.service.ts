import { Injectable, NotFoundException } from '@nestjs/common';
import { AccountService } from '../account/account.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';
import { UrlImportManager } from '@app/core/url-import/url-import.manager';
import { WebhookManager } from '@app/core/webhook/webhook.manager';
import { FormManager } from '@app/core/form/form.manager';
import { ViewManager } from '@app/core/view/view.manager';
import { build_usage } from '@app/core/plan/usage';

// `GET /usage` (#183): the account's plan, each of its caps and how much of it is used. Only
// ever the signed-in account's own.
@Injectable()
export class UsageService {
    constructor(
        private readonly account_svc: AccountService,
        private readonly tracking_manager: TrackingManager,
        private readonly url_import_manager: UrlImportManager,
        private readonly webhook_manager: WebhookManager,
        private readonly form_manager: FormManager,
        private readonly view_manager: ViewManager
    ) {}

    async usage(acct_id: number) {
        const account = await this.account_svc.get(acct_id);
        if (!account) throw new NotFoundException();
        const plan = await this.tracking_manager.plan(account);
        const tables = await this.tracking_manager.table_usage(account);
        const views = await Promise.all(tables.map(t => this.view_manager.count(acct_id, t.id)));
        return build_usage({
            plan,
            now: this.tracking_manager.now(),
            tables: tables.map((t, i) => ({ ...t, views: views[i] })),
            storage_bytes: await this.tracking_manager.storage_bytes(account, true),
            api_calls: await this.tracking_manager.api_calls_this_month(account),
            url_sources: await this.url_import_manager.count(acct_id),
            webhooks: await this.webhook_manager.count(acct_id),
            forms: await this.form_manager.count(acct_id)
        });
    }
}
