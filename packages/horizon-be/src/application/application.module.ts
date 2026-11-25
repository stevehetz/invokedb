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
import { BillingService } from '@app/application/billing/billing.service';
import { stripe_client_provider } from '@app/application/billing/stripe-client';
import { JobService } from './job/job.service';
import { TableTemplateService } from './table-template/table-template.service';
import { OnboardingService } from './onboarding/onboarding.service';

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
        BillingService,
        stripe_client_provider,
        JobService,
        TableTemplateService,
        OnboardingService
    ],
    exports: [
        AuthService,
        HttpStrategy,
        FileDirectoryService,
        WebFileService,
        WebFilePrcService,
        WebFilePrcNotifyService,
        AccountService,
        BillingService,
        JobService,
        TableTemplateService,
        OnboardingService
    ]
})
export class ApplicationModule {}
