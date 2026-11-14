import { Controller, Post, Request, HttpStatus, Response, HttpException } from '@nestjs/common';
import { IncomingWebhook } from '@slack/webhook';
import env from '@app/env';
import logger from '@app/logger';

@Controller('support')
export class SupportController {
    constructor() {}

    @Post('/request')
    async request(@Request() req, @Response() res) {
        const url = env.SLACK_SUPPORT_WEBHOOK_URL;
        const body = req.body;

        if (!url) {
            // Local dev without Slack: log the request instead.
            logger.info(`[support request, no SLACK_SUPPORT_WEBHOOK_URL] ${JSON.stringify(body)}`);
            return res.status(HttpStatus.OK).send('success');
        }
        const webhook = new IncomingWebhook(url);

        const content = `
<!@channel> New Support Request

Email: ${body.email}
Subject: ${body.subject}
Message: ${body.message}
`;

        await webhook.send({
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: content
                    }
                }
            ]
        });
        return res.status(HttpStatus.OK).send('success');
    }
}
