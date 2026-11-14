if (!process.env.IS_TS_NODE) {
    // tslint:disable-next-line:no-var-requires
    require('module-alias/register');
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { WebModule } from '@app/web/web.module';
import { AllExceptionFilter } from './all-exception.filter';
import env from './env';

async function bootstrap() {
    const app = await NestFactory.create(WebModule, { cors: true });
    app.useGlobalPipes(
        new ValidationPipe({
            transform: true,
            whitelist: true
        })
    );
    app.useGlobalFilters(new AllExceptionFilter());
    await app.listen(env.HORIZON_BE_PRIV_HTTP_PORT);
}
bootstrap();
