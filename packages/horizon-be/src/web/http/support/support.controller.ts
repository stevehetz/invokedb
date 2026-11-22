import { Controller, Post, Request, HttpStatus, Response, HttpException } from '@nestjs/common';
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

        if (!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)) {
            // Telegram isn't configured (e.g. local dev): log the request instead.
            logger.info(`[support request, Telegram not configured]\n${text}`);
            return res.status(HttpStatus.OK).send('success');
        }

        try {
            await this.send_telegram(text);
        } catch (err) {
            logger.error(`support request: Telegram failed: ${err.message}\n${text}`);
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
}
