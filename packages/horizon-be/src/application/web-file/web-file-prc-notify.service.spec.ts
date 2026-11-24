import { WebFilePrcNotifyService } from './web-file-prc-notify.service';
import { WebsocketClientStore } from '@app/websocket/client.store';
import _c from '@app/constants';

jest.mock('@app/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));

describe('WebFilePrcNotifyService', () => {
    const repository = { findOneBy: jest.fn(async () => ({ id: 1 })) };
    // An empty store: the websocket clients don't exist yet (#44)
    const service = new WebFilePrcNotifyService(repository as any, new WebsocketClientStore());

    it("doesn't reject when the websocket clients don't exist yet", async () => {
        await expect(
            service.ws_pr_send_to_fe({ client_id: _c.HORIZON_FS_WS_CLIENT_ID, file_id: 1 })
        ).resolves.toBeUndefined();
        await expect(service.job_start(_c.HORIZON_FS_WS_CLIENT_ID, 2, 1)).resolves.toBeUndefined();
        await expect(
            service.job_error(_c.HORIZON_PRC_WS_CLIENT_ID, 2, 1, new Error('x'))
        ).resolves.toBeUndefined();
        await expect(
            service.job_complete(_c.HORIZON_PRC_WS_CLIENT_ID, 2, 1)
        ).resolves.toBeUndefined();
    });

    it("doesn't reject when the database lookup fails", async () => {
        repository.findOneBy.mockRejectedValueOnce(new Error('db down'));
        await expect(service.job_complete('x', 2, 1)).resolves.toBeUndefined();
    });
});
