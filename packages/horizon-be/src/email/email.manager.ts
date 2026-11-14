import { Injectable } from '@nestjs/common';
import env from '@app/env';

const Mailgun = require('mailgun-js');

@Injectable()
export class EmailManager {
    constructor() {}

    send_html(to, subject, html) {
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
                throw new Error(err);
            } else {
                return 'success';
            }
        });

        return 'success';
    }
}
