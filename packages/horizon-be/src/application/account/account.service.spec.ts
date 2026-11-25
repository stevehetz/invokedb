import { AccountService } from './account.service';

// AccountManager loads `uuid`, which is ESM only; these tests don't need it
jest.mock('@app/core/account/account.manager', () => ({ AccountManager: class {} }));

describe('AccountService.delete_account', () => {
    function make(cancel: jest.Mock) {
        const account_repository = { update: jest.fn(async () => ({ affected: 1 })) };
        const service = new AccountService(
            account_repository as any,
            {} as any,
            { cancel_for_deleted_account: cancel } as any
        );
        return { service, account_repository };
    }

    it('cancels billing, then marks the account deleted', async () => {
        const cancel = jest.fn(async () => undefined);
        const { service, account_repository } = make(cancel);
        await service.delete_account(7);
        expect(cancel).toHaveBeenCalledWith(7);
        expect(account_repository.update).toHaveBeenCalledWith({ id: 7 }, { deleted: true });
    });

    it("doesn't delete the account when cancelling its subscription fails", async () => {
        const cancel = jest.fn(async () => {
            throw new Error('stripe down');
        });
        const { service, account_repository } = make(cancel);
        await expect(service.delete_account(7)).rejects.toThrow('stripe down');
        expect(account_repository.update).not.toHaveBeenCalled();
    });
});
