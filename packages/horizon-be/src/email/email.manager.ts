import { Injectable } from '@nestjs/common';
import env from '@app/env';
import logger from '@app/logger';
import { is_demo_email } from '@app/core/demo/demo';

const FROM = 'InvokeDB <noreply@invokedb.com>';

@Injectable()
export class EmailManager {
    constructor() {}

    get is_configured() {
        return Boolean(env.MAILGUN_API_KEY && env.MAILGUN_DN);
    }

    send_html(to, subject, html) {
        // A demo account (#333) has no mailbox: nothing is ever sent to one
        if (is_demo_email(to)) {
            logger.info(`[email dropped: a demo account] subject=${subject}`);
            return 'success';
        }
        if (!env.MAILGUN_API_KEY) {
            // Local dev without Mailgun: log the email instead of sending it.
            logger.info(`[email skipped: no MAILGUN_API_KEY] to=${to} subject=${subject}\n${html}`);
            return 'success';
        }

        // Fire and forget, as before: callers don't wait on delivery.
        this.send_mailgun({ to, subject, html }).catch(err =>
            logger.error(`Failed to send email to ${to}: ${err}`)
        );
        return 'success';
    }

    // Plain-text email that the caller awaits; throws if Mailgun doesn't accept it.
    async send_text(to: string, subject: string, text: string, reply_to?: string) {
        if (is_demo_email(to)) {
            logger.info(`[email dropped: a demo account] subject=${subject}`);
            return;
        }
        const fields: Record<string, string> = { to, subject, text };
        if (reply_to && !is_demo_email(reply_to)) {
            fields['h:Reply-To'] = reply_to;
        }
        await this.send_mailgun(fields);
    }

    // Mailgun HTTP API: https://documentation.mailgun.com/docs/mailgun/api-reference/
    private async send_mailgun(fields: Record<string, string>) {
        const body = new URLSearchParams({ from: FROM, ...fields });
        const auth = Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString('base64');
        const res = await fetch(`https://api.mailgun.net/v3/${env.MAILGUN_DN}/messages`, {
            method: 'POST',
            headers: { Authorization: `Basic ${auth}` },
            body,
            signal: AbortSignal.timeout(15000)
        });
        if (!res.ok) {
            throw new Error(`Mailgun responded ${res.status}: ${await res.text()}`);
        }
    }
}
