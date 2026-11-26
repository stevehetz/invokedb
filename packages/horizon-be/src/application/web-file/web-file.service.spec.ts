import { HttpException, HttpStatus } from '@nestjs/common';
import { WebFileService } from './web-file.service';
import { TrackingManager } from '@app/core/tracking/tracking.manager';

jest.mock('@app/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));

// A locked account deletes nothing, through the app or /api/v1 (#172)
describe('WebFileService deletes on a locked account', () => {
    const locked = { id: 7, locked: true, locked_reason: 'unpaid' };
    const unlocked = { id: 7, locked: false };

    let tracking: TrackingManager;
    let web_file_manager: any;
    let webhook_svc: any;
    let service: WebFileService;

    beforeEach(() => {
        // The real lock check, with no databases behind it
        tracking = new TrackingManager({} as any, {} as any, {} as any);
        jest.spyOn(tracking, 'update_req_count').mockResolvedValue(undefined);
        jest.spyOn(tracking, 'check_table_lock').mockResolvedValue(undefined);
        jest.spyOn(tracking, 'deleted_rows').mockResolvedValue(undefined);
        web_file_manager = {
            batch_delete: jest.fn(async () => 0),
            existing_row_ids: jest.fn(async () => [])
        };
        webhook_svc = { wants: jest.fn(async () => false), emit: jest.fn(async () => {}) };
        service = new WebFileService(
            {} as any,
            {} as any,
            web_file_manager,
            tracking,
            {} as any,
            webhook_svc,
            { rows: jest.fn(async () => {}), columns: jest.fn(async () => {}) } as any,
            { rows_changed: jest.fn(async () => {}) } as any
        );
    });

    async function expect_locked(promise: Promise<unknown>) {
        const err: HttpException = await promise.then(
            () => null,
            e => e
        );
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(err.message).toBe('Account locked: unpaid');
    }

    it('refuses /api/v1/delete with the same error as create and update', async () => {
        await expect_locked(service.external_delete_rows(locked, 1, ['a']));
        const create_err = await service.external_create_rows(locked, 1, [{}], null).catch(e => e);
        const update_err = await service
            .external_update_rows(locked, 1, [{ _id: 'a' }], null)
            .catch(e => e);
        expect(create_err.message).toBe('Account locked: unpaid');
        expect(update_err.message).toBe('Account locked: unpaid');
        expect(tracking.update_req_count).not.toHaveBeenCalled();
        expect(web_file_manager.batch_delete).not.toHaveBeenCalled();
    });

    it("refuses the app's batch delete and deletes nothing", async () => {
        await expect_locked(service.batch_delete(locked, 1, 'data_grid_row', ['a']));
        expect(web_file_manager.batch_delete).not.toHaveBeenCalled();
        expect(tracking.deleted_rows).not.toHaveBeenCalled();
        expect(webhook_svc.emit).not.toHaveBeenCalled();
    });

    it('still deletes for an unlocked account', async () => {
        await service.external_delete_rows(unlocked, 1, ['a']);
        await service.batch_delete(unlocked, 1, 'data_grid_row', ['b']);
        expect(web_file_manager.batch_delete).toHaveBeenCalledTimes(2);
    });
});
