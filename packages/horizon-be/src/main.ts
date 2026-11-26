if (!process.env.IS_TS_NODE) {
    require('module-alias/register');
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WebModule } from '@app/web/web.module';
import { AllExceptionFilter } from './all-exception.filter';
import env from './env';
import { process_source, report_error } from './core/error-tracking/report';

// An uncaught exception or unhandled rejection (Node's default `throw` mode turns the second
// into the first) still ends the process, as before, but is recorded first (#212), waiting at
// most FATAL_REPORT_MS for it.
const FATAL_REPORT_MS = 3000;
let exiting = false;
process.on('uncaughtException', (err, origin) => {
    console.error(`${origin}:`, err);
    if (exiting) return;
    exiting = true;
    const timeout = new Promise(resolve => setTimeout(resolve, FATAL_REPORT_MS));
    Promise.race([report_error(process_source(), err, { route: origin }), timeout]).finally(() =>
        process.exit(1)
    );
});

async function bootstrap() {
    if (!env.HORIZON_WS_SERVER_TOKEN) {
        throw new Error('HORIZON_WS_SERVER_TOKEN must be set (outside local mode)');
    }
    // rawBody: Stripe's webhook signature (#129) is checked over the body exactly as sent
    const app = await NestFactory.create<NestExpressApplication>(WebModule, {
        cors: true,
        rawBody: true
    });
    // Express 5 defaults to the "simple" query parser; keep qs-style nesting (sort[a]=desc)
    app.set('query parser', 'extended');
    // In production Caddy is the one proxy in front (the API port isn't published), so trust one
    // hop: req.ip is then the client's address from X-Forwarded-For, not Caddy's. The rate limits
    // on the email-sending routes key on it (#133).
    app.set('trust proxy', 1);
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
