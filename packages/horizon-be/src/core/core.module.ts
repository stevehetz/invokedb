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
import { Session } from './session/session.entity';
import { Subscription } from './subscription/subscription.entity';
import { WebsocketClientStore } from '@app/websocket/client.store';
import { Job } from './job/job.entity';
import { AccountIdentity } from './account-identity/account-identity.entity';
import { ApiKey } from './api-key/api-key.entity';
import { JobManager } from './job/job.manager';
import { OnboardingManager } from './onboarding/onboarding.manager';
import { UrlImportManager } from './url-import/url-import.manager';
import { UrlSyncProcessor } from './web-file/url-sync-processor';
import { WebhookManager } from './webhook/webhook.manager';
import { FormManager } from './form/form.manager';

@Module({
    imports: [
        DatabaseModule,
        EmailModule,
        TypeOrmModule.forFeature([
            Account,
            AccountIdentity,
            ApiKey,
            FileDirectory,
            ResetPassword,
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
        FormManager,
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
        FormManager,
        WebsocketClientStore,
        TypeOrmModule
    ]
})
export class CoreModule {}
