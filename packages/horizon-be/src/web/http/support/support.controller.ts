import {
    Controller,
    Post,
    Request,
    HttpStatus,
    Response,
    HttpException,
    UseGuards
} from '@nestjs/common';
import env from '@app/env';
import logger from '@app/logger';
import { EmailManager } from '@app/email/email.manager';
import { RateLimitGuard } from '@app/web/http/_rate-limit/rate-limit';
import { send_telegram, telegram_configured } from '@app/core/telegram/telegram';

// Telegram rejects messages over 4096 characters.
const MAX_FIELD_LENGTH = 3000;

const field = (value, max = 200) => String(value ?? '').slice(0, max);

// One line, no control characters (keeps the email subject a single header line).
const one_line = (value: string) => value.replace(/[\x00-\x1f\x7f]+/g, ' ').trim();

// Loose check, only to decide whether the address is safe to use as Reply-To.
const is_email = (value: string) => /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(value);

// The contact form. It emails SUPPORT_EMAIL through Mailgun, with Reply-To set to the person, so
// a reply from the support inbox goes to them. Telegram is only a fallback, used when Mailgun
// refuses the call (or isn't set up). Failures after Mailgun accepts the email can't be seen here.
@Controller('support')
export class SupportController {
    constructor(private email_manager: EmailManager) {}

    @Post('/request')
    // By IP and by the sender's email (#133)
    @UseGuards(
        new RateLimitGuard({ name: 'support', per_ip: 5, per_email: 5, window_ms: 60 * 60 * 1000 })
    )
    async request(@Request() req, @Response() res) {
        const email = one_line(field(req.body?.email));
        const subject = one_line(field(req.body?.subject));
        const message = field(req.body?.message, MAX_FIELD_LENGTH);
        const text = `New support request\n\nEmail: ${email}\nSubject: ${subject}\n\n${message}`;

        const can_email = Boolean(env.SUPPORT_EMAIL && this.email_manager.is_configured);
        const can_telegram = telegram_configured();

        if (!can_email && !can_telegram) {
            // Neither is configured (e.g. local dev): log the request instead.
            logger.info(`[support request, no email or Telegram configured]\n${text}`);
            return res.status(HttpStatus.OK).send('success');
        }

        if (can_email) {
            try {
                await this.email_manager.send_text(
                    env.SUPPORT_EMAIL,
                    `Support: ${subject || '(no subject)'}`,
                    text,
                    is_email(email) ? email : undefined
                );
                return res.status(HttpStatus.OK).send('success');
            } catch (err) {
                logger.error(`support request: email failed: ${err.message}`);
            }
        }

        if (can_telegram) {
            try {
                await send_telegram(text);
                return res.status(HttpStatus.OK).send('success');
            } catch (err) {
                logger.error(`support request: Telegram failed: ${err.message}`);
            }
        }

        logger.error(`support request could not be sent\n${text}`);
        throw new HttpException('Support request could not be sent', HttpStatus.BAD_GATEWAY);
    }
}
