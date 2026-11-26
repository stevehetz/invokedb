import {
    ACCOUNT_TABLES,
    AccountDeletionService,
    SHARED_TRACKING_COLLECTIONS,
    is_account_collection
} from './account-deletion.service';

describe('AccountDeletionService', () => {
    it("matches only the account's own tracking collections", () => {
        expect(is_account_collection('tracking:onboarding:acct_1', 1)).toBe(true);
        expect(is_account_collection('tracking:row_count:acct_1', 1)).toBe(true);
        expect(is_account_collection('tracking:row_count:acct_12', 1)).toBe(false);
        expect(is_account_collection('tracking:row_count:acct_1', 12)).toBe(false);
        expect(is_account_collection('tracking:form', 1)).toBe(false);
    });

    it("deletes the account's database, its tracking data and its Postgres rows, the account last", async () => {
        const dropped: string[] = [];
        const deleted: Array<{ name: string; filter: any }> = [];
        const queries: Array<[string, any[]]> = [];
        const account_db = { dropDatabase: jest.fn(async () => true) };
        const tracking_db = {
            listCollections: () => ({
                toArray: async () =>
                    [
                        'tracking:onboarding:acct_5',
                        'tracking:api_month:acct_5',
                        'tracking:api_month:acct_51',
                        'tracking:form'
                    ].map(name => ({ name }))
            }),
            collection: (name: string) => ({ drop: async () => dropped.push(name) })
        };
        const collections = {
            get_db_name: (id: number) => `horizon:acct_${id}`,
            get_mongo_db: jest.fn(async (name: string) =>
                name === 'horizon:acct_5' ? account_db : tracking_db
            ),
            get_shared_tracking_collection: async (name: string) => ({
                find: () => ({ toArray: async () => [] }),
                deleteMany: async (filter: any) => deleted.push({ name, filter })
            })
        };
        const data_source = {
            transaction: async (fn: any) =>
                fn({ query: async (sql: string, params: any[]) => queries.push([sql, params]) })
        };
        const service = new AccountDeletionService(data_source as any, collections as any);

        await service.delete_account(5);

        expect(collections.get_mongo_db).toHaveBeenCalledWith('horizon:acct_5');
        expect(account_db.dropDatabase).toHaveBeenCalled();
        expect(dropped).toEqual(['tracking:onboarding:acct_5', 'tracking:api_month:acct_5']);
        expect(deleted.map(d => d.name)).toEqual(SHARED_TRACKING_COLLECTIONS);
        expect(SHARED_TRACKING_COLLECTIONS).toEqual([
            'tracking:url_source',
            'tracking:webhook',
            'tracking:webhook_delivery',
            'tracking:form',
            'tracking:view',
            'tracking:audit',
            'tracking:ai_usage',
            'tracking:api_key_request',
            'tracking:account_export',
            'tracking:ai_column'
        ]);
        deleted.forEach(d => expect(d.filter).toEqual({ account_id: 5 }));
        expect(queries.map(q => q[0])).toEqual([
            ...ACCOUNT_TABLES.map(t => `DELETE FROM ${t} WHERE account_id = $1`),
            'DELETE FROM account WHERE id = $1'
        ]);
        queries.forEach(q => expect(q[1]).toEqual([5]));
    });

    it('refuses anything that is not an account id', async () => {
        const service = new AccountDeletionService({} as any, {} as any);
        for (const id of [0, -1, 1.5, NaN, undefined as any, '5' as any]) {
            await expect(service.delete_account(id)).rejects.toThrow('Not an account id');
        }
    });
});
