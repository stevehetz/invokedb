import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { MongoDbCollections } from './mongodb/collections';
import { AccountManager } from './account/account.manager';
import { SessionManager } from './session/session.manager';
import { WebFileManager } from './web-file/web-file.manager';
import { CsvProcessor } from './web-file/csv-processor';
import { TrackingManager } from './tracking/tracking.manager';
import { Account } from './account/account.entity';
import { FileDirectory } from './file-directory/file-directory.entity';
import { ResetPassword } from './reset-password/reset-password.entity';
import { EmailVerification } from './email-verification/email-verification.entity';
import { Session } from './session/session.entity';
import { Subscription } from './subscription/subscription.entity';
import { WebsocketClientStore } from '@app/websocket/client.store';
import { Job } from './job/job.entity';
import { AccountIdentity } from './account-identity/account-identity.entity';
import { ApiKey } from './api-key/api-key.entity';
import { TwoFactor } from './two-factor/two-factor.entity';
import { JobManager } from './job/job.manager';
import { OnboardingManager } from './onboarding/onboarding.manager';
import { UrlImportManager } from './url-import/url-import.manager';
import { UrlSyncProcessor } from './web-file/url-sync-processor';
import { WebhookManager } from './webhook/webhook.manager';
import { KeyRequestLogManager } from './api-key/key-request-log.manager';
import { FormManager } from './form/form.manager';
import { ViewManager } from './view/view.manager';
import { AiClient } from './ai/ai-client';
import { AiUsageManager } from './ai/ai-usage.manager';
import { AiSpend } from './ai/ai-spend';
import { AiColumnManager } from './ai-column/ai-column.manager';
import { AuditManager } from './audit/audit.manager';
import { AccountExportManager } from './account-export/account-export.manager';
import { ErrorTrackingManager } from './error-tracking/error-tracking.manager';
import { StatusManager } from './status/status.manager';

@Module({
    imports: [
        DatabaseModule,
        EmailModule,
        TypeOrmModule.forFeature([
            Account,
            AccountIdentity,
            ApiKey,
            TwoFactor,
            FileDirectory,
            ResetPassword,
            EmailVerification,
            Session,
            Subscription,
            Job
        ])
    ],
    providers: [
        MongoDbCollections,
        AccountManager,
        SessionManager,
        WebFileManager,
        CsvProcessor,
        TrackingManager,
        JobManager,
        OnboardingManager,
        UrlImportManager,
        UrlSyncProcessor,
        WebhookManager,
        KeyRequestLogManager,
        FormManager,
        ViewManager,
        AiClient,
        AiUsageManager,
        AiSpend,
        AiColumnManager,
        AuditManager,
        AccountExportManager,
        ErrorTrackingManager,
        StatusManager,
        WebsocketClientStore
    ],
    exports: [
        MongoDbCollections,
        AccountManager,
        SessionManager,
        WebFileManager,
        CsvProcessor,
        TrackingManager,
        JobManager,
        OnboardingManager,
        UrlImportManager,
        UrlSyncProcessor,
        WebhookManager,
        KeyRequestLogManager,
        FormManager,
        ViewManager,
        AiClient,
        AiUsageManager,
        AiSpend,
        AiColumnManager,
        AuditManager,
        AccountExportManager,
        ErrorTrackingManager,
        StatusManager,
        WebsocketClientStore,
        TypeOrmModule
    ]
})
export class CoreModule {}
