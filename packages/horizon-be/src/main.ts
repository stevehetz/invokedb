if (!process.env.IS_TS_NODE) {
    require('module-alias/register');
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WebModule } from '@app/web/web.module';
import { AllExceptionFilter } from './all-exception.filter';
import env from './env';

async function bootstrap() {
    if (!env.HORIZON_WS_SERVER_TOKEN) {
        throw new Error('HORIZON_WS_SERVER_TOKEN must be set (outside local mode)');
    }
    // rawBody: the Stripe webhook's signature is over the exact bytes (req.rawBody)
    const app = await NestFactory.create<NestExpressApplication>(WebModule, {
        cors: true,
        rawBody: true
    });
    // Express 5 defaults to the "simple" query parser; keep qs-style nesting (sort[a]=desc)
    app.set('query parser', 'extended');
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
