import {
    DeletedAccountService,
    PURGE_PER_RUN,
    deleted_account_ids
} from './deleted-account.service';

describe('deleted_account_ids', () => {
    it('picks only accounts marked deleted, oldest id first', () => {
        expect(
            deleted_account_ids([
                { id: 9, deleted: true },
                { id: 3, deleted: false },
                { id: 4, deleted: true },
                { id: 5 },
                { id: 6, deleted: null },
                { id: 7, deleted: 'true' }
            ])
        ).toEqual([4, 9]);
    });

    it('skips ids that are not account ids', () => {
        expect(
            deleted_account_ids([
                { id: 0, deleted: true },
                { id: -1, deleted: true },
                { id: 1.5, deleted: true },
                { id: '2', deleted: true },
                { id: null, deleted: true },
                null as any,
                { id: 2, deleted: true }
            ])
        ).toEqual([2]);
    });

    it('takes at most the limit per run', () => {
        const many = Array.from({ length: PURGE_PER_RUN + 10 }, (_, i) => ({
            id: i + 1,
            deleted: true
        }));
        expect(deleted_account_ids(many)).toHaveLength(PURGE_PER_RUN);
        expect(deleted_account_ids(many, 2)).toEqual([1, 2]);
        expect(deleted_account_ids(many, 0)).toEqual([]);
    });
});

describe('DeletedAccountService.run', () => {
    function setup(rows: Array<{ id: number; deleted: boolean }>) {
        const account_repository = {
            find: jest.fn(async ({ where }: any) =>
                rows.filter(r => r.deleted === where.deleted).map(r => ({ ...r }))
            ),
            findOne: jest.fn(async ({ where }: any) => {
                const r = rows.find(x => x.id === where.id);
                return r ? { ...r } : null;
            })
        };
        const deletion = {
            delete_account: jest.fn(async (id: number) => {
                if (id === 13) throw new Error('mongo down');
                const i = rows.findIndex(r => r.id === id);
                if (i >= 0) rows.splice(i, 1);
            })
        };
        const service = new DeletedAccountService(account_repository as any, deletion as any);
        return { service, account_repository, deletion, rows };
    }

    it('deletes the data of accounts marked deleted, and nothing else', async () => {
        const s = setup([
            { id: 1, deleted: false },
            { id: 2, deleted: true },
            { id: 3, deleted: true }
        ]);
        expect(await s.service.run()).toEqual([2, 3]);
        expect(s.deletion.delete_account).toHaveBeenCalledTimes(2);
        expect(s.rows).toEqual([{ id: 1, deleted: false }]);
        // Done: the next run has nothing left
        expect(await s.service.run()).toEqual([]);
    });

    it('reads each account again and skips one no longer marked deleted', async () => {
        const s = setup([{ id: 2, deleted: true }]);
        s.account_repository.findOne.mockImplementationOnce(async () => ({
            id: 2,
            deleted: false
        }));
        expect(await s.service.run()).toEqual([]);
        expect(s.deletion.delete_account).not.toHaveBeenCalled();
    });

    it('goes on after a failed deletion and tries it again next run', async () => {
        const s = setup([
            { id: 13, deleted: true },
            { id: 14, deleted: true }
        ]);
        expect(await s.service.run()).toEqual([14]);
        expect(await s.service.run()).toEqual([]);
        expect(s.deletion.delete_account).toHaveBeenCalledTimes(3);
        expect(s.rows).toEqual([{ id: 13, deleted: true }]);
    });
});
