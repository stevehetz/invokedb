import { Injectable } from '@nestjs/common';
import { WebhookDelivery, WebhookManager } from '@app/core/webhook/webhook.manager';
import {
    SIGNATURE_HEADER,
    is_delivered,
    next_retry_at,
    parse_test_hosts,
    signature_header
} from '@app/core/webhook/webhook';
import { send_webhook } from '@app/core/webhook/webhook-send';
import env from '@app/env';
import logger from '@app/logger';

// How often the processor looks for deliveries due to be sent
const CHECK_INTERVAL_MS = 2 * 1000;
// Deliveries sent at once, and at most per check
const CONCURRENCY = 5;
const MAX_PER_CHECK = 50;

// Sends webhook deliveries (#140) in the job processor (IS_HORIZON_PRC), apart from the request
// that changed the rows. A failed attempt is retried with backoff (RETRY_DELAYS_SEC); every
// attempt is kept in the delivery's log.
@Injectable()
export class WebhookPrcService {
    private running = false;
    private test_hosts = parse_test_hosts(env.HORIZON_WEBHOOK_TEST_HOSTS);

    constructor(private webhook_manager: WebhookManager) {
        if (env.IS_HORIZON_PRC) {
            setInterval(() => this.check(), CHECK_INTERVAL_MS);
        }
    }

    async check() {
        if (this.running) return;
        this.running = true;
        let sent = 0;
        const worker = async () => {
            while (sent < MAX_PER_CHECK) {
                const delivery = await this.webhook_manager.claim_due(Date.now());
                if (!delivery) return;
                sent++;
                await this.deliver(delivery);
            }
        };
        try {
            await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        } catch (ex) {
            logger.error(`Webhook deliveries failed: ${ex && ex.message}`);
        } finally {
            this.running = false;
        }
    }

    async deliver(delivery: WebhookDelivery) {
        const hook = await this.webhook_manager.get(delivery.account_id, delivery.webhook_id);
        if (!hook) {
            await this.webhook_manager.drop_delivery(delivery);
            return;
        }
        // Signed when sent, so a retry has a fresh timestamp
        const timestamp = Math.floor(Date.now() / 1000);
        const at = Date.now();
        const res = await send_webhook(
            hook.url,
            delivery.body,
            {
                'InvokeDB-Event': delivery.event,
                'InvokeDB-Delivery': delivery.id,
                'InvokeDB-Webhook': hook.id,
                'InvokeDB-Timestamp': String(timestamp),
                [SIGNATURE_HEADER]: signature_header(hook.secret, timestamp, delivery.body)
            },
            { test_hosts: this.test_hosts }
        );
        const delivered = is_delivered(res.status);
        const next = delivered ? null : next_retry_at(delivery.attempts + 1, Date.now());
        await this.webhook_manager.attempt_done(
            delivery,
            { at, status: res.status, ms: res.ms, error: res.error, response: res.response },
            delivered,
            next
        );
        if (!delivered) {
            logger.debug(
                `Webhook ${hook.id} delivery ${delivery.id} attempt ${delivery.attempts + 1} failed: ${res.error}`
            );
        }
    }
}
