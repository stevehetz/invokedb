import { Controller, Post, Request, HttpStatus, Response, HttpException } from '@nestjs/common';
import { IncomingWebhook } from '@slack/webhook';
import env from '@app/env';
import logger from '@app/logger';

// Telegram rejects messages over 4096 characters.
const MAX_FIELD_LENGTH = 3000;

const field = (value, max = 200) => String(value ?? '').slice(0, max);

@Controller('support')
export class SupportController {
    constructor() {}

    @Post('/request')
    async request(@Request() req, @Response() res) {
        const email = field(req.body?.email);
        const subject = field(req.body?.subject);
        const message = field(req.body?.message, MAX_FIELD_LENGTH);
        const text = `New support request\n\nEmail: ${email}\nSubject: ${subject}\n\n${message}`;

        const has_telegram = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);
        const has_slack = !!env.SLACK_SUPPORT_WEBHOOK_URL;
        if (!has_telegram && !has_slack) {
            // No notification channel configured (e.g. local dev): log the request instead.
            logger.info(`[support request, no Telegram or Slack configured]\n${text}`);
            return res.status(HttpStatus.OK).send('success');
        }

        let delivered = false;
        if (has_telegram) {
            try {
                await this.send_telegram(text);
                delivered = true;
            } catch (err) {
                logger.error(`support request: Telegram failed: ${err.message}\n${text}`);
            }
        }
        if (has_slack) {
            try {
                await this.send_slack(text);
                delivered = true;
            } catch (err) {
                logger.error(`support request: Slack failed: ${err.message}\n${text}`);
            }
        }
        if (!delivered) {
            throw new HttpException('Support request could not be sent', HttpStatus.BAD_GATEWAY);
        }
        return res.status(HttpStatus.OK).send('success');
    }

    // Telegram Bot API: https://core.telegram.org/bots/api#sendmessage
    // Sent as plain text (no parse_mode), so user input can't inject formatting.
    private async send_telegram(text: string) {
        const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
        });
        if (!res.ok) {
            throw new Error(`Telegram responded ${res.status}: ${await res.text()}`);
        }
    }

    private async send_slack(text: string) {
        const webhook = new IncomingWebhook(env.SLACK_SUPPORT_WEBHOOK_URL);
        await webhook.send({ text: `<!channel> ${text}` });
    }
}
