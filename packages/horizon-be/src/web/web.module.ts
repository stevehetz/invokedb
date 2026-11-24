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
        SupportController
    ],
    providers: [WebsocketServer, WebsocketClient]
})
export class WebModule {}
