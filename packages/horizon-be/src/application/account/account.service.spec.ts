import { AccountService } from './account.service';

// uuid is ESM-only, which Jest can't load (AccountManager imports it)
jest.mock('uuid', () => ({ v4: () => jest.requireActual('crypto').randomUUID() }));

// Deleting an account ends every one of its sessions (#282)
describe('AccountService.delete_account', () => {
    it('marks the account deleted and deletes all its sessions', async () => {
        const account_repository = { update: jest.fn(async () => ({ affected: 1 })) };
        const session_repository = { delete: jest.fn(async () => ({ affected: 2 })) };
        const service = new AccountService(
            account_repository as any,
            session_repository as any,
            {} as any
        );

        await service.delete_account(41);

        expect(account_repository.update).toHaveBeenCalledWith({ id: 41 }, { deleted: true });
        expect(session_repository.delete).toHaveBeenCalledWith({ account_id: 41 });
    });
});
