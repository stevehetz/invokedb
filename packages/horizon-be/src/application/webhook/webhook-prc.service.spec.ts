import { WebhookPrcService } from './webhook-prc.service';
import { send_webhook } from '@app/core/webhook/webhook-send';

jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), debug: jest.fn() }
}));
jest.mock('@app/core/webhook/webhook-send', () => ({
    send_webhook: jest.fn(async () => ({ status: 200, ms: 1, error: null, response: '' }))
}));

const ACCT = 7;

function setup(hook: any) {
    const webhook_manager = {
        get: jest.fn(async () => hook),
        drop_delivery: jest.fn(async () => undefined),
        attempt_done: jest.fn(async () => 'ok')
    };
    const svc = new WebhookPrcService(webhook_manager as any);
    return { svc, webhook_manager };
}

function delivery(event: string) {
    return {
        id: 'd1',
        account_id: ACCT,
        webhook_id: 'w1',
        event,
        body: '{}',
        attempts: 0
    } as any;
}

function hook(enabled: boolean) {
    return {
        id: 'w1',
        account_id: ACCT,
        url: 'https://example.com/hook',
        secret: 'whsec_x',
        enabled
    };
}

describe('WebhookPrcService.deliver', () => {
    beforeEach(() => (send_webhook as jest.Mock).mockClear());

    it('sends a row event for an enabled webhook', async () => {
        const { svc, webhook_manager } = setup(hook(true));
        await svc.deliver(delivery('row.created'));
        expect(send_webhook).toHaveBeenCalledTimes(1);
        expect(webhook_manager.attempt_done).toHaveBeenCalled();
        expect(webhook_manager.drop_delivery).not.toHaveBeenCalled();
    });

    it('drops a queued row event (or its retry) once the webhook is disabled', async () => {
        const { svc, webhook_manager } = setup(hook(false));
        await svc.deliver(delivery('row.updated'));
        expect(send_webhook).not.toHaveBeenCalled();
        expect(webhook_manager.drop_delivery).toHaveBeenCalledTimes(1);
        expect(webhook_manager.attempt_done).not.toHaveBeenCalled();
    });

    it('still sends the test event to a disabled webhook', async () => {
        const { svc, webhook_manager } = setup(hook(false));
        await svc.deliver(delivery('ping'));
        expect(send_webhook).toHaveBeenCalledTimes(1);
        expect(webhook_manager.drop_delivery).not.toHaveBeenCalled();
    });

    it('drops a delivery whose webhook is gone', async () => {
        const { svc, webhook_manager } = setup(null);
        await svc.deliver(delivery('row.deleted'));
        expect(send_webhook).not.toHaveBeenCalled();
        expect(webhook_manager.drop_delivery).toHaveBeenCalledTimes(1);
    });
});
