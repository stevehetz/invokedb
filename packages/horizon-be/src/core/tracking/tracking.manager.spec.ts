import { TrackingManager } from './tracking.manager';
import { get_plans } from '../billing/plans';

// Each tier's caps, with Mongo and Postgres faked: `tables` is the account's table count and
// `rows` the row count of every table.
function make({ tables = 0, rows = 0, api_calls = 0 } = {}) {
    let req_count = api_calls;
    const collections = {
        get_collection: jest.fn(async () => ({
            findOneAndUpdate: jest.fn(async () => ({ count: ++req_count })),
            findOne: jest.fn(async () => ({ count: req_count })),
            updateOne: jest.fn(async () => undefined)
        })),
        get_dg_collection: jest.fn(async () => ({ countDocuments: jest.fn(async () => rows) }))
    };
    const account_repository = { update: jest.fn(async () => undefined) };
    const file_directory_repository = {
        countBy: jest.fn(async () => tables),
        findBy: jest.fn(async () => Array.from({ length: tables }, (_, i) => ({ id: i + 1 }))),
        findOneBy: jest.fn(async () => null),
        update: jest.fn(async () => undefined)
    };
    const manager = new TrackingManager(
        collections as any,
        account_repository as any,
        file_directory_repository as any
    );
    return { manager, account_repository, file_directory_repository };
}

const plans = get_plans();

describe.each(['free', 'pro', 'internal'])('TrackingManager caps on %s', plan_id => {
    const limits = plans[plan_id].limits;
    const account = { id: 1, plan: plan_id, locked: false };

    it('allows a table up to the cap and refuses the next', async () => {
        await expect(
            make({ tables: limits.max_tables - 1 }).manager.add_table(account)
        ).resolves.toBeUndefined();
        await expect(
            make({ tables: limits.max_tables }).manager.add_table(account)
        ).rejects.toMatchObject({ status: 403 });
    });

    it('allows rows up to the cap and refuses past it', async () => {
        const { manager } = make({ rows: limits.max_rows - 1 });
        await expect(
            manager.add_rows(account, { file_id: 1, rows_to_be_added: 1 })
        ).resolves.toBeUndefined();
        await expect(
            manager.add_rows(account, { file_id: 1, rows_to_be_added: 2 })
        ).rejects.toMatchObject({ status: 403 });
        await expect(
            manager.validate_row_count(account, limits.max_rows + 1)
        ).rejects.toMatchObject({ status: 403 });
    });

    it('allows API calls up to the monthly cap and refuses the next with 429', async () => {
        const { manager } = make({ api_calls: limits.max_api_calls_per_month - 1 });
        await expect(manager.update_req_count(account)).resolves.toBeUndefined();
        await expect(manager.update_req_count(account)).rejects.toMatchObject({ status: 429 });
    });
});

describe('TrackingManager read-only', () => {
    const free = plans.free.limits;

    it('locks an account over the table cap after a downgrade, and unlocks it on upgrade', async () => {
        const { manager, account_repository } = make({ tables: free.max_tables + 1 });
        await manager.on_plan_change({ id: 1, plan: 'free' });
        expect(account_repository.update).toHaveBeenLastCalledWith(
            { id: 1 },
            expect.objectContaining({ locked: true })
        );
        await manager.on_plan_change({ id: 1, plan: 'pro' });
        expect(account_repository.update).toHaveBeenLastCalledWith(
            { id: 1 },
            { locked: false, locked_reason: null }
        );
    });

    it('locks tables over the row cap after a downgrade', async () => {
        const { manager, file_directory_repository } = make({ tables: 1, rows: free.max_rows + 1 });
        await manager.on_plan_change({ id: 1, plan: 'free' });
        expect(file_directory_repository.update).toHaveBeenLastCalledWith(
            { id: 1 },
            expect.objectContaining({ locked: true })
        );
        await manager.on_plan_change({ id: 1, plan: 'pro' });
        expect(file_directory_repository.update).toHaveBeenLastCalledWith(
            { id: 1 },
            { locked: false, locked_reason: null }
        );
    });

    it('refuses writes to a locked account, including new tables', async () => {
        const { manager } = make();
        const locked = { id: 1, plan: 'free', locked: true, locked_reason: 'over' };
        await expect(manager.check_account_lock(locked)).rejects.toMatchObject({ status: 403 });
        await expect(manager.add_table(locked)).rejects.toMatchObject({ status: 403 });
    });

    it('reports usage against the plan', async () => {
        const { manager } = make({ tables: 2, rows: 7, api_calls: 4 });
        await expect(manager.get_usage({ id: 1, plan: 'free', locked: false })).resolves.toEqual({
            plan: 'free',
            plan_status: null,
            limits: free,
            tables: 2,
            max_table_rows: 7,
            api_calls_this_month: 4,
            read_only: false,
            read_only_reason: null
        });
    });
});
