import { HttpException, HttpStatus } from '@nestjs/common';
import { FileDirectoryService, with_folder_contents } from './file-directory.service';

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

describe('with_folder_contents: deleting a folder (#357)', () => {
    const item = (id: number, parent_id: number | null, type = 'file') => ({ id, parent_id, type });
    const live = [
        item(1, null, 'dir'),
        item(2, 1),
        item(3, 1),
        item(4, null),
        item(5, 1, 'dir'),
        item(6, 5)
    ];
    const ids = (items: { id: number }[]) => items.map(i => i.id);

    it('takes what is in a folder, before the folder', () => {
        expect(ids(with_folder_contents([live[0]], live))).toEqual([2, 3, 6, 5, 1]);
    });

    it('leaves a table or an empty folder alone', () => {
        expect(ids(with_folder_contents([live[3]], live))).toEqual([4]);
        expect(ids(with_folder_contents([item(9, null, 'dir')], live))).toEqual([9]);
    });

    it('lists each item once when a table and its folder are both asked for', () => {
        expect(ids(with_folder_contents([live[1], live[0]], live))).toEqual([2, 3, 6, 5, 1]);
    });
});

describe('FileDirectoryService.update_owned and names in use (#366)', () => {
    /** Two tables at the top level, a folder holding a table named "orders", and a folder. */
    function with_items() {
        const items: any[] = [
            { id: 1, account_id: ACCT, name: 'Customers', type: 'file', parent_id: null },
            { id: 2, account_id: ACCT, name: 'Orders', type: 'file', parent_id: null },
            { id: 3, account_id: ACCT, name: 'Archive', type: 'dir', parent_id: null },
            { id: 4, account_id: ACCT, name: 'orders', type: 'file', parent_id: 3 },
            { id: 5, account_id: ACCT, name: 'Old', type: 'file', parent_id: 3, deleted: true }
        ].map(f => ({ deleted: false, ...f }));
        const repo = {
            find: jest.fn(async ({ where }) =>
                items.filter(f => f.account_id === where.account_id && !f.deleted)
            ),
            findOneBy: jest.fn(async ({ id }) => items.find(f => f.id === id) || null),
            update: jest.fn(async (id, changes) => {
                Object.assign(
                    items.find(f => f.id === id),
                    changes
                );
            })
        };
        const audit_svc = { record: jest.fn(async () => undefined) };
        const account_service = { get: jest.fn(async id => ({ id })) };
        const svc = new FileDirectoryService(
            repo as any,
            account_service as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            audit_svc as any,
            {} as any
        );
        return { svc, repo, items };
    }

    const refused = async (p: Promise<any>) => {
        const err = await p.catch(e => e);
        expect(err).toBeInstanceOf(HttpException);
        expect(err.message).toBe('Name in use');
    };

    it('refuses renaming onto a name taken in the same folder, in any case', async () => {
        const { svc, repo } = with_items();
        await refused(svc.update_owned(ACCT, 1, { name: 'orders' }));
        expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses moving into a folder holding the same name', async () => {
        const { svc, repo } = with_items();
        await refused(svc.update_owned(ACCT, 2, { parent_id: 3 }));
        await refused(svc.update_owned(ACCT, 4, { parent_id: null }));
        expect(repo.update).not.toHaveBeenCalled();
    });

    it('lets an item keep its own name, or change its case', async () => {
        const { svc, items } = with_items();
        await svc.update_owned(ACCT, 2, { name: 'Orders' });
        await svc.update_owned(ACCT, 2, { name: 'ORDERS' });
        expect(items[1].name).toBe('ORDERS');
    });

    it('allows a name used by another type or a deleted item, or in another folder', async () => {
        const { svc, items } = with_items();
        await svc.update_owned(ACCT, 1, { name: 'Archive' });
        await svc.update_owned(ACCT, 4, { name: 'Old' });
        await svc.update_owned(ACCT, 1, { name: 'Customers', parent_id: 3 });
        expect(items[0]).toMatchObject({ name: 'Customers', parent_id: 3 });
        expect(items[3].name).toBe('Old');
    });
});
