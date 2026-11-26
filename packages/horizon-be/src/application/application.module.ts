import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailModule } from '@app/email/email.module';
import { CoreModule } from '@app/core/core.module';
import { AuthService } from '@app/application/auth/auth.service';
import { AccountService } from '@app/application/account/account.service';
import { HttpStrategy } from '@app/application/auth/http.strategy';
import { GoogleStrategy } from '@app/application/auth/sso/google.strategy';
import { GithubStrategy } from '@app/application/auth/sso/github.strategy';
import { FileDirectoryService } from '@app/application/file-directory/file-directory.service';
import { WebFileService } from '@app/application/web-file/web-file.service';
import { WebFilePrcService } from './web-file/web-file-prc.service';
import { WebFilePrcNotifyService } from './web-file/web-file-prc-notify.service';
import { SubscriptionService } from '@app/application/subscription/subscription.service';
import { JobService } from './job/job.service';
import { TableTemplateService } from './table-template/table-template.service';
import { OnboardingService } from './onboarding/onboarding.service';
import { UrlImportService } from './url-import/url-import.service';
import { WebhookService } from './webhook/webhook.service';
import { WebhookPrcService } from './webhook/webhook-prc.service';
import { FormService } from './form/form.service';
import { ApiKeyService } from './api-key/api-key.service';
import { ViewService } from './view/view.service';
import { AskService } from './ai/ask.service';
import { AiService } from './ai/ai.service';
import { EditService } from './ai/edit.service';
import { CleanupService } from './ai/cleanup.service';
import { ImportTextService } from './ai/import-text.service';
import { AiColumnService } from './ai-column/ai-column.service';
import { AuditService } from './audit/audit.service';
import { TwoFactorService } from './two-factor/two-factor.service';
import { AccountExportService } from './account-export/account-export.service';
import { UsageService } from './plan/usage.service';
import { PlanStateService } from './plan/plan-state.service';
import { IdleAccountService } from './plan/idle-account.service';
import { AccountDeletionService } from './account/account-deletion.service';
import { AdminAccessService } from './admin/admin-access.service';
import { AdminService } from './admin/admin.service';
import { ErrorTrackingService } from './error-tracking/error-tracking.service';
import { StatusService } from './status/status.service';

@Module({
    imports: [CoreModule, EmailModule],
    providers: [
        AuthService,
        HttpStrategy,
        GoogleStrategy,
        GithubStrategy,
        FileDirectoryService,
        WebFileService,
        WebFilePrcService,
        WebFilePrcNotifyService,
        AccountService,
        SubscriptionService,
        JobService,
        TableTemplateService,
        OnboardingService,
        UrlImportService,
        WebhookService,
        WebhookPrcService,
        FormService,
        ApiKeyService,
        ViewService,
        AskService,
        AiService,
        EditService,
        CleanupService,
        ImportTextService,
        AiColumnService,
        AuditService,
        TwoFactorService,
        AccountExportService,
        UsageService,
        PlanStateService,
        IdleAccountService,
        AccountDeletionService,
        AdminAccessService,
        AdminService,
        ErrorTrackingService,
        StatusService
    ],
    exports: [
        AuthService,
        HttpStrategy,
        FileDirectoryService,
        WebFileService,
        WebFilePrcService,
        WebFilePrcNotifyService,
        AccountService,
        SubscriptionService,
        JobService,
        TableTemplateService,
        OnboardingService,
        UrlImportService,
        WebhookService,
        FormService,
        ApiKeyService,
        ViewService,
        AskService,
        AiService,
        EditService,
        CleanupService,
        ImportTextService,
        AiColumnService,
        AuditService,
        TwoFactorService,
        AccountExportService,
        UsageService,
        PlanStateService,
        AdminAccessService,
        AdminService,
        ErrorTrackingService,
        StatusService
    ]
})
export class ApplicationModule {}
