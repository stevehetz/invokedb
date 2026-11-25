import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DASHBOARD_LIMITS } from '@app/core/dashboard/dashboard';

// Stand-ins below; the real ones pull in TypeORM and ESM-only packages
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));

const ACCT = 7;
const OTHER = 8;
const CHART_VIEW = 'view_' + 'c'.repeat(24);
const GRID_VIEW = 'view_' + 'a'.repeat(24);
const OTHER_VIEW = 'view_' + 'b'.repeat(24);

function setup() {
    const dashboards: any[] = [];
    const files = {
        11: { id: 11, account_id: ACCT, name: 'tasks', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'theirs', type: 'file', deleted: false },
        13: { id: 13, account_id: ACCT, name: 'gone', type: 'file', deleted: true },
        14: { id: 14, account_id: ACCT, name: 'folder', type: 'dir', deleted: false }
    };
    const views = [
        {
            id: CHART_VIEW,
            account_id: ACCT,
            file_id: 11,
            name: 'By status',
            type: 'chart',
            filters: [],
            sort: null,
            hidden_fields: [],
            chart: { kind: 'bar', group_field: 'b', agg: 'count', value_field: null }
        },
        {
            id: GRID_VIEW,
            account_id: ACCT,
            file_id: 11,
            name: 'Open',
            type: 'grid',
            filters: [{ field: 'b', type: 'equals', value: 'To do' }],
            sort: { field: 'c', dir: 'desc' },
            hidden_fields: ['a']
        },
        { id: OTHER_VIEW, account_id: OTHER, file_id: 12, name: 'x', type: 'grid', filters: [] }
    ];
    const file_directory_svc = { get_by_id: jest.fn(async id => files[id] || null) };
    const accounts = { [ACCT]: { id: ACCT }, [OTHER]: { id: OTHER } };
    const account_svc = { get: jest.fn(async id => accounts[id] || null) };
    const tracking_manager = { check_account_lock: jest.fn(async () => undefined) };
    const web_file_manager = {
        get_all: jest.fn(async () => ({
            data: [
                { field: 'a', headerName: 'Task', order: 1 },
                { field: 'b', headerName: 'Status', order: 2 },
                { field: 'c', headerName: 'Hours', col_type: 'number', order: 3 }
            ]
        })),
        format_data_response: jest.fn(rows => rows)
    };
    const view_manager = {
        get: jest.fn(async (acct, id) => views.find(v => v.account_id === acct && v.id === id)),
        aggregate_rows: jest.fn(async (..._args: any[]): Promise<any[]> => []),
        find_rows: jest.fn(async (..._args: any[]): Promise<any[]> => [])
    };
    const dashboard_manager = {
        list: jest.fn(async acct => dashboards.filter(d => d.account_id === acct)),
        count: jest.fn(async acct => dashboards.filter(d => d.account_id === acct).length),
        get: jest.fn(async (acct, id) =>
            dashboards.find(d => d.account_id === acct && d.id === id)
        ),
        get_shared: jest.fn(async token =>
            token ? dashboards.find(d => d.share_token === token) : null
        ),
        create: jest.fn(async d => (dashboards.push(d), d)),
        update: jest.fn(async (acct, id, changes) => {
            const d = dashboards.find(x => x.account_id === acct && x.id === id);
            Object.assign(d, changes);
            return d;
        }),
        remove: jest.fn(async (acct, id) => {
            const i = dashboards.findIndex(d => d.account_id === acct && d.id === id);
            if (i >= 0) dashboards.splice(i, 1);
        }),
        count_rows: jest.fn(async () => 7)
    };
    const svc = new DashboardService(
        file_directory_svc as any,
        account_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        view_manager as any,
        dashboard_manager as any
    );
    return { svc, dashboards, view_manager, dashboard_manager, files, views, accounts };
}

const TILES = [
    { type: 'chart', file_id: 11, view_id: CHART_VIEW },
    { type: 'table', file_id: 11, view_id: GRID_VIEW, limit: 5, wide: true },
    { type: 'stat', file_id: 11, agg: 'sum', value_field: 'c', title: 'Hours' }
];

describe('DashboardService', () => {
    it('saves, lists, renames and deletes a dashboard', async () => {
        const { svc, dashboards } = setup();
        const d = await svc.create(ACCT, { name: 'Ops', tiles: TILES });
        expect(d.id).toMatch(/^dash_[0-9a-f]{24}$/);
        expect(d.share_token).toBeNull();
        expect(d).not.toHaveProperty('account_id');
        expect(d.tiles.map(t => t.type)).toEqual(['chart', 'table', 'stat']);

        expect((await svc.list(ACCT)).dashboards.map(x => x.id)).toEqual([d.id]);
        expect((await svc.list(OTHER)).dashboards).toEqual([]);

        const renamed = await svc.update(ACCT, d.id, { name: 'Ops 2' });
        expect(renamed.name).toBe('Ops 2');
        expect(renamed.tiles).toHaveLength(3);

        await svc.remove(ACCT, d.id);
        expect(dashboards).toHaveLength(0);
        await expect(svc.get(ACCT, d.id)).rejects.toThrow(NotFoundException);
    });

    it("refuses tiles on another account's table or view, or a deleted table", async () => {
        const { svc } = setup();
        const bad = [
            { type: 'stat', file_id: 12 },
            { type: 'stat', file_id: 13 },
            { type: 'stat', file_id: 14 },
            { type: 'stat', file_id: 99 },
            { type: 'table', file_id: 11, view_id: OTHER_VIEW },
            { type: 'chart', file_id: 11, view_id: GRID_VIEW },
            { type: 'stat', file_id: 11, agg: 'sum', value_field: 'a' }
        ];
        for (const t of bad) {
            await expect(svc.create(ACCT, { name: 'x', tiles: [t] })).rejects.toThrow(
                BadRequestException
            );
        }
    });

    it("can't see, change, share or delete another account's dashboard", async () => {
        const { svc } = setup();
        const d = await svc.create(ACCT, { name: 'Ops', tiles: TILES });
        await expect(svc.get(OTHER, d.id)).rejects.toThrow(NotFoundException);
        await expect(svc.data(OTHER, d.id)).rejects.toThrow(NotFoundException);
        await expect(svc.update(OTHER, d.id, { name: 'mine' })).rejects.toThrow(NotFoundException);
        await expect(svc.share(OTHER, d.id)).rejects.toThrow(NotFoundException);
        await expect(svc.remove(OTHER, d.id)).rejects.toThrow(NotFoundException);
    });

    it('stops at the per-account limit', async () => {
        const { svc } = setup();
        for (let i = 0; i < DASHBOARD_LIMITS.max_per_account; i++) {
            await svc.create(ACCT, { name: `d${i}` });
        }
        await expect(svc.create(ACCT, { name: 'one more' })).rejects.toThrow(ForbiddenException);
    });

    it("reads each tile's data now, with its view's filters", async () => {
        const { svc, view_manager } = setup();
        const d = await svc.create(ACCT, { name: 'Ops', tiles: TILES });
        view_manager.aggregate_rows.mockImplementation(async (_a, _f, pipeline: any[]) => {
            const group = pipeline[1].$group;
            return group._id === null ? [{ value: 6.5 }] : [{ _id: 'To do', value: 2 }];
        });
        view_manager.find_rows.mockImplementation(async () => [
            { _id: 'r1', a: 'Write', b: 'To do', c: 2 }
        ]);
        const out = await svc.data(ACCT, d.id);
        const [chart, table, stat] = out.tiles;
        expect(chart).toMatchObject({
            title: '',
            heading: 'By status',
            error: null,
            data: { kind: 'bar', points: [{ label: 'To do', value: 2 }] }
        });
        expect(table.heading).toBe('Open');
        expect(table.data.columns.map(c => c.field)).toEqual(['b', 'c']);
        expect(table.data.rows).toEqual([{ b: 'To do', c: 2 }]);
        expect(table.data.total).toBe(7);
        // The grid view's filter and sort, and the tile's row count
        const [, , filter, sort, limit] = view_manager.find_rows.mock.calls[0];
        expect(filter).toEqual({ $and: [{ b: { $regex: '^To do$' } }] });
        expect(sort).toEqual({ c: -1, _id: 1 });
        expect(limit).toBe(5);
        expect(stat).toMatchObject({
            heading: 'Hours',
            data: { agg: 'sum', column: 'Hours', value: 6.5 }
        });
    });

    it('shows an error in a tile whose view or table has gone, not a failed page', async () => {
        const { svc, views, files } = setup();
        const d = await svc.create(ACCT, { name: 'Ops', tiles: TILES });
        views.splice(0, 1);
        files[11].deleted = true;
        const out = await svc.data(ACCT, d.id);
        expect(out.tiles.every(t => t.data === null && /deleted/.test(t.error))).toBe(true);
    });

    it('shares by a link, read-only and without ids, and revokes it', async () => {
        const { svc } = setup();
        const d = await svc.create(ACCT, { name: 'Ops', tiles: TILES });
        const shared = await svc.share(ACCT, d.id);
        expect(shared.share_token).toMatch(/^dsh_[0-9a-f]{32}$/);

        const pub = await svc.public_view(shared.share_token);
        expect(pub.name).toBe('Ops');
        expect(pub).not.toHaveProperty('id');
        expect(pub).not.toHaveProperty('share_token');
        expect(pub.tiles).toHaveLength(3);
        pub.tiles.forEach(t => {
            expect(t).not.toHaveProperty('file_id');
            expect(t).not.toHaveProperty('view_id');
        });

        // A new link replaces the old one
        const again = await svc.share(ACCT, d.id);
        expect(again.share_token).not.toBe(shared.share_token);
        await expect(svc.public_view(shared.share_token)).rejects.toThrow(NotFoundException);

        await svc.unshare(ACCT, d.id);
        await expect(svc.public_view(again.share_token)).rejects.toThrow(NotFoundException);
        await expect(svc.public_view('dsh_nope')).rejects.toThrow(NotFoundException);
    });

    it('stops showing a shared dashboard once its account is gone', async () => {
        const { svc, accounts } = setup();
        const d = await svc.create(ACCT, { name: 'Ops', tiles: TILES });
        const { share_token } = await svc.share(ACCT, d.id);
        delete accounts[ACCT];
        await expect(svc.public_view(share_token)).rejects.toThrow(NotFoundException);
    });
});
