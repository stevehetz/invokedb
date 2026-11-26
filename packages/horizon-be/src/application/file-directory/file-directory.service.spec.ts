import { HttpException, HttpStatus } from '@nestjs/common';
import { FileDirectoryService } from './file-directory.service';

// Stand-ins below; the real ones pull in TypeORM and ESM-only packages
jest.mock('../account/account.service', () => ({}));
jest.mock('../web-file/web-file-prc-notify.service', () => ({}));

const ACCT = 7;
const MAX_TABLES = 3;

/** An account already holding `tables` saved tables, under a plan allowing MAX_TABLES. */
function setup(tables: number) {
    const saved: any[] = [];
    for (let i = 0; i < tables; i++) {
        saved.push({ id: i + 1, account_id: ACCT, name: `t${i}`, type: 'file', deleted: false });
    }
    const repo = {
        find: jest.fn(async ({ where }) =>
            saved.filter(f => f.account_id === where.account_id && !f.deleted)
        ),
        save: jest.fn(async f => {
            const row = { ...f, id: saved.length + 1 };
            saved.push(row);
            return row;
        })
    };
    const account_service = {
        get: jest.fn(async id => ({ id, email_verified: true }))
    };
    // Mirrors TrackingManager.add_table: saved tables plus this one must fit the limit
    const tracking_manager = {
        add_table: jest.fn(async () => {
            const count = saved.filter(f => f.type === 'file' && !f.deleted).length;
            if (count + 1 > MAX_TABLES) {
                throw new HttpException('Table limit exceeded', HttpStatus.FORBIDDEN);
            }
            return async () => undefined;
        })
    };
    const web_file_manager = { create_new: jest.fn(async () => undefined) };
    const onboarding_manager = { record_table_created: jest.fn(async () => undefined) };
    const audit_svc = { record: jest.fn(async () => undefined) };
    const svc = new FileDirectoryService(
        repo as any,
        account_service as any,
        web_file_manager as any,
        tracking_manager as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        onboarding_manager as any,
        audit_svc as any,
        {} as any
    );
    return { svc, saved, tracking_manager, web_file_manager };
}

describe('FileDirectoryService.create and the table limit (#237)', () => {
    it('lets an account at its table limit create a folder', async () => {
        const { svc, saved, tracking_manager, web_file_manager } = setup(MAX_TABLES);
        const res = await svc.create(ACCT, { name: 'Archive', type: 'dir' }, true);
        expect(res).toMatchObject({ name: 'Archive', type: 'dir', account_id: ACCT });
        expect(saved).toHaveLength(MAX_TABLES + 1);
        expect(tracking_manager.add_table).not.toHaveBeenCalled();
        expect(web_file_manager.create_new).not.toHaveBeenCalled();
    });

    it('still refuses a table at the limit with 403', async () => {
        const { svc, saved } = setup(MAX_TABLES);
        const err = await svc.create(ACCT, { name: 'One more', type: 'file' }, false).catch(e => e);
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.FORBIDDEN);
        expect(saved).toHaveLength(MAX_TABLES);
    });

    it('reserves a place for a table under the limit', async () => {
        const { svc, saved, tracking_manager } = setup(MAX_TABLES - 1);
        await svc.create(ACCT, { name: 'Last one', type: 'file' }, false);
        expect(tracking_manager.add_table).toHaveBeenCalledTimes(1);
        expect(saved).toHaveLength(MAX_TABLES);
    });
});
