import { Module } from '@nestjs/common';
import { ApplicationModule } from '@app/application/application.module';
import { EmailModule } from '@app/email/email.module';
import { AuthController } from '@app/web/http/auth/auth.controller';
import { SsoController } from '@app/web/http/auth/sso.controller';
import { AccountController } from '@app/web/http/account/account.controller';
import { FileDirectoryController } from '@app/web/http/file-directory/file-directory.controller';
import { WebFileController } from '@app/web/http/web-file/web-file.controller';
import { ExternalV1Controller } from './http/external/external-v1.controller';
import { SubscriptionController } from './http/subscription/subscription.controller';
import { SupportController } from './http/support/support.controller';
import { HealthController } from './http/health/health.controller';
import { TableTemplateController } from './http/table-template/table-template.controller';
import { OnboardingController } from './http/onboarding/onboarding.controller';
import { OnboardingInterceptor } from './http/external/onboarding.interceptor';
import { ApiKeyUsageGuard } from './http/external/api-key-usage.guard';
import { UrlImportController } from './http/url-import/url-import.controller';
import { WebhookController } from './http/webhook/webhook.controller';
import { FormController, PublicFormController } from './http/form/form.controller';
import { ApiKeyController } from './http/api-key/api-key.controller';
import { ViewController } from './http/view/view.controller';
import { AiController } from './http/ai/ai.controller';
import { AuditController } from './http/audit/audit.controller';
import { TwoFactorController } from './http/two-factor/two-factor.controller';
import { AccountExportController } from './http/account-export/account-export.controller';
import { PlanController, UsageController } from './http/plan/plan.controller';
import { AdminController } from './http/admin/admin.controller';
import { AdminGuard } from './http/admin/admin.guard';
import { CoreModule } from '@app/core/core.module';
import { WebsocketServer } from './ws/websocket-server';
import { WebsocketClient } from './ws/websocket-client';

@Module({
    imports: [ApplicationModule, CoreModule, EmailModule],
    controllers: [
        AuthController,
        SsoController,
        FileDirectoryController,
        WebFileController,
        ExternalV1Controller,
        AccountController,
        SubscriptionController,
        SupportController,
        HealthController,
        TableTemplateController,
        OnboardingController,
        UrlImportController,
        WebhookController,
        FormController,
        PublicFormController,
        ApiKeyController,
        ViewController,
        AiController,
        AuditController,
        TwoFactorController,
        AccountExportController,
        PlanController,
        UsageController,
        AdminController
    ],
    providers: [
        WebsocketServer,
        WebsocketClient,
        OnboardingInterceptor,
        ApiKeyUsageGuard,
        AdminGuard
    ]
})
export class WebModule {}
