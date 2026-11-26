import { AccountService } from './account.service';

// uuid is ESM-only, which Jest can't load (AccountManager imports it)
jest.mock('uuid', () => ({ v4: () => jest.requireActual('crypto').randomUUID() }));

function setup(delete_data: (id: number) => Promise<void> = async () => {}) {
    const order: string[] = [];
    const account_repository = {
        update: jest.fn(async () => {
            order.push('mark');
            return { affected: 1 };
        })
    };
    const session_repository = {
        delete: jest.fn(async () => {
            order.push('sessions');
            return { affected: 2 };
        })
    };
    const deletion = {
        delete_account: jest.fn(async (id: number) => {
            order.push('data');
            await delete_data(id);
        })
    };
    const service = new AccountService(
        account_repository as any,
        session_repository as any,
        {} as any,
        deletion as any
    );
    return { service, account_repository, session_repository, deletion, order };
}

// Deleting an account ends every one of its sessions (#282) and deletes its data at once (#279)
describe('AccountService.delete_account', () => {
    it('marks the account deleted, deletes all its sessions, then all its data', async () => {
        const s = setup();

        expect(await s.service.delete_account(41)).toEqual({ deleted: true });

        expect(s.account_repository.update).toHaveBeenCalledWith({ id: 41 }, { deleted: true });
        expect(s.session_repository.delete).toHaveBeenCalledWith({ account_id: 41 });
        expect(s.deletion.delete_account).toHaveBeenCalledWith(41);
        expect(s.order).toEqual(['mark', 'sessions', 'data']);
    });

    it('leaves the account marked deleted for the sweep when deleting its data fails', async () => {
        const s = setup(async () => {
            throw new Error('mongo down');
        });

        expect(await s.service.delete_account(41)).toEqual({ deleted: true });
        expect(s.order).toEqual(['mark', 'sessions', 'data']);
    });

    it('deletes nothing when the before-delete hook refuses', async () => {
        const s = setup();
        s.service.set_before_delete(async () => {
            throw new Error('Stripe refused');
        });

        await expect(s.service.delete_account(41)).rejects.toThrow('Stripe refused');
        expect(s.order).toEqual([]);
    });
});
