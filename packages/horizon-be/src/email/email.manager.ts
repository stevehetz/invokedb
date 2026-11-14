import { Injectable } from '@nestjs/common';
import env from '@app/env';
import logger from '@app/logger';

@Injectable()
export class EmailManager {
    constructor() {}

    send_html(to, subject, html) {
        if (!env.MAILGUN_API_KEY) {
            // Local dev without Mailgun: log the email instead of sending it.
            logger.info(`[email skipped: no MAILGUN_API_KEY] to=${to} subject=${subject}\n${html}`);
            return 'success';
        }

        // Fire and forget, as before: callers don't wait on delivery.
        this.send_mailgun(to, subject, html).catch(err =>
            logger.error(`Failed to send email to ${to}: ${err}`)
        );
        return 'success';
    }

    // Mailgun HTTP API: https://documentation.mailgun.com/docs/mailgun/api-reference/
    private async send_mailgun(to, subject, html) {
        const body = new URLSearchParams({
            from: 'InvokeDB <noreply@invokedb.com>',
            to,
            subject,
            html
        });
        const auth = Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString('base64');
        const res = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DN}/messages`, {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}` },
            body
        });
        if (!res.ok) {
            throw new Error(`Mailgun responded ${res.status}: ${await res.text()}`);
        }
    }
}
