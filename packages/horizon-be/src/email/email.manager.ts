import { Injectable } from '@nestjs/common';
import env from '@app/env';
import logger from '@app/logger';

const Mailgun = require('mailgun-js');

@Injectable()
export class EmailManager {
    constructor() {}

    send_html(to, subject, html) {
        if (!env.MAILGUN_API_KEY) {
            // Local dev without Mailgun: log the email instead of sending it.
            logger.info(`[email skipped: no MAILGUN_API_KEY] to=${to} subject=${subject}\n${html}`);
            return 'success';
        }

        const mailgun = new Mailgun({
            apiKey: env.MAILGUN_API_KEY,
            domain: env.MAILGUN_DN
        });

        const data = {
            from: 'InvokeDB <noreply@invokedb.com>',
            to,
            subject,
            html
        };

        mailgun.messages().send(data, (err, body) => {
            if (err) {
                logger.error(`Failed to send email to ${to}: ${err}`);
            } else {
                return 'success';
            }
        });

        return 'success';
    }
}
