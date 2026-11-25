import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ViewService } from './view.service';
import { VIEW_LIMITS } from '@app/core/view/view';
import { PLANS, PLAN_IDS, PLAN_SUBSCRIPTIONS, PlanId } from '@app/core/plan/plans';

// Stand-ins below; the real ones pull in TypeORM and ESM-only packages
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));

const ACCT = 7;
const OTHER = 8;

// The account is on Pro unless a test says otherwise, so the tests can make several views
function setup(plan_id: PlanId = 'PRO') {
    const views: any[] = [];
    const files = {
        11: { id: 11, account_id: ACCT, name: 'tasks', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'theirs', type: 'file', deleted: false },
        13: { id: 13, account_id: ACCT, name: 'gone', type: 'file', deleted: true }
    };
    const file_directory_svc = {
        assert_owned: jest.fn(async (acct, id) => {
            const f = files[Number(id)];
            if (!f) throw new NotFoundException();
            if (f.account_id !== acct) throw new ForbiddenException();
            return f;
        })
    };
    const account_svc = {
        get: jest.fn(async id => ({ id, subscription_id: PLAN_SUBSCRIPTIONS[plan_id] }))
    };
    const tracking_manager = { check_account_lock: jest.fn(async () => undefined) };
    const web_file_manager = {
        get_all: jest.fn(async () => ({
            data: [
                { field: 'a', headerName: 'Task', order: 1 },
                { field: 'b', headerName: 'Status', order: 2 },
                { field: 'c', headerName: 'Hours', col_type: 'number', order: 3 },
                { field: 'd', headerName: 'Due', col_type: 'date', order: 4 },
                { field: 'e', headerName: 'Lng', col_type: 'number', order: 5 }
            ]
        })),
        format_data_response: jest.fn(rows => rows)
    };
    const view_manager = {
        list: jest.fn(async (acct, file_id) =>
            views.filter(v => v.account_id === acct && v.file_id === file_id)
        ),
        count: jest.fn(
            async (acct, file_id) =>
                views.filter(v => v.account_id === acct && v.file_id === file_id).length
        ),
        get: jest.fn(async (acct, id) => views.find(v => v.account_id === acct && v.id === id)),
        create: jest.fn(async v => (views.push(v), v)),
        update: jest.fn(async (acct, id, changes) => {
            const v = views.find(x => x.account_id === acct && x.id === id);
            Object.assign(v, changes);
            return v;
        }),
        remove: jest.fn(async (acct, id) => {
            const i = views.findIndex(v => v.account_id === acct && v.id === id);
            if (i >= 0) views.splice(i, 1);
        }),
        aggregate_rows: jest.fn(async (..._args: any[]): Promise<any[]> => []),
        count_rows: jest.fn(async (..._args: any[]): Promise<number> => 0),
        find_rows: jest.fn(async (..._args: any[]): Promise<any[]> => [])
    };
    const svc = new ViewService(
        file_directory_svc as any,
        account_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        view_manager as any
    );
    return { svc, views, view_manager, tracking_manager };
}

describe('ViewService', () => {
    it('saves, lists, renames and deletes a grid view', async () => {
        const { svc, views } = setup();
        const v = await svc.create(ACCT, {
            file_id: 11,
            name: 'Open',
            filters: [{ field: 'b', type: 'equals', value: 'To do' }],
            sort: { field: 'c', dir: 'desc' },
            hidden_fields: ['a']
        });
        expect(v).toMatchObject({ name: 'Open', type: 'grid', file_id: 11 });
        expect(v).not.toHaveProperty('account_id');
        expect(views[0].account_id).toBe(ACCT);

        const list = await svc.list(ACCT, '11');
        expect(list.views.map(x => x.id)).toEqual([v.id]);
        expect(list.columns.map(c => c.field)).toEqual(['a', 'b', 'c', 'd', 'e']);

        expect((await svc.update(ACCT, v.id, { name: 'Renamed' })).name).toBe('Renamed');
        await expect(svc.update(ACCT, v.id, { file_id: 12 })).rejects.toThrow(BadRequestException);
        await expect(svc.update(ACCT, v.id, { name: '' })).rejects.toThrow(BadRequestException);
        expect(await svc.remove(ACCT, v.id)).toEqual({ deleted: v.id });
        await expect(svc.get(ACCT, v.id)).rejects.toThrow(NotFoundException);
    });

    it('keeps accounts apart', async () => {
        const { svc } = setup();
        const v = await svc.create(ACCT, { file_id: 11, name: 'Mine' });
        await expect(svc.get(OTHER, v.id)).rejects.toThrow(NotFoundException);
        await expect(svc.update(OTHER, v.id, { name: 'x' })).rejects.toThrow(NotFoundException);
        await expect(svc.remove(OTHER, v.id)).rejects.toThrow(NotFoundException);
        await expect(svc.kanban(OTHER, v.id)).rejects.toThrow(NotFoundException);
        await expect(svc.list(OTHER, 11)).rejects.toThrow(ForbiddenException);
        await expect(svc.create(OTHER, { file_id: 11, name: 'x' })).rejects.toThrow(
            ForbiddenException
        );
        await expect(svc.create(ACCT, { file_id: 12, name: 'x' })).rejects.toThrow(
            ForbiddenException
        );
        await expect(svc.create(ACCT, { file_id: 13, name: 'x' })).rejects.toThrow(
            NotFoundException
        );
        await expect(svc.create(ACCT, { name: 'x' })).rejects.toThrow(BadRequestException);
    });

    describe.each(PLAN_IDS)('on %s', plan_id => {
        it("caps the views per table at the plan's and checks the account lock", async () => {
            const { svc, views, tracking_manager } = setup(plan_id);
            const cap = PLANS[plan_id].caps.views_per_table;
            for (let i = 0; i < cap - 1; i++) {
                views.push({ id: `v${i}`, account_id: ACCT, file_id: 11 });
            }
            await expect(svc.create(ACCT, { file_id: 11, name: 'last' })).resolves.toBeTruthy();
            const err = await svc.create(ACCT, { file_id: 11, name: 'one more' }).catch(e => e);
            expect(err.getStatus()).toBe(403);
            expect(err.getResponse()).toMatchObject({
                code: 'plan_limit',
                limit: 'views_per_table',
                cap
            });
            expect(tracking_manager.check_account_lock).toHaveBeenCalled();
        });
    });

    it('reads a kanban board, a column per value', async () => {
        const { svc, view_manager } = setup();
        const v = await svc.create(ACCT, {
            file_id: 11,
            name: 'Board',
            type: 'kanban',
            kanban: { group_field: 'b' },
            filters: [{ field: 'c', type: 'greaterThan', value: '1' }]
        });
        view_manager.aggregate_rows.mockResolvedValueOnce([
            { _id: null, count: 1 },
            { _id: 'Done', count: 2 }
        ]);
        view_manager.find_rows.mockImplementation(async (...args: any[]) => [
            { _id: 'r', filter: args[2] }
        ]);
        const board = await svc.kanban(ACCT, v.id);
        expect(board.group_field).toBe('b');
        expect(board.groups.map(g => [g.value, g.count])).toEqual([
            [null, 1],
            ['Done', 2]
        ]);
        expect(view_manager.find_rows.mock.calls[1][2]).toEqual({
            $and: [{ $and: [{ c: { $gt: 1 } }] }, { b: 'Done' }]
        });
        await expect(svc.chart(ACCT, v.id)).rejects.toThrow(BadRequestException);
    });

    it('reads a chart', async () => {
        const { svc, view_manager } = setup();
        const v = await svc.create(ACCT, {
            file_id: 11,
            name: 'Hours',
            type: 'chart',
            chart: { kind: 'pie', group_field: 'b', agg: 'sum', value_field: 'c' }
        });
        view_manager.aggregate_rows.mockResolvedValueOnce([{ _id: 'Done', value: 3 }]);
        expect(await svc.chart(ACCT, v.id)).toEqual({
            kind: 'pie',
            group_field: 'b',
            agg: 'sum',
            value_field: 'c',
            points: [{ label: 'Done', value: 3 }],
            truncated: false
        });
        await expect(svc.kanban(ACCT, v.id)).rejects.toThrow(BadRequestException);
    });

    it('reads a calendar over a range of days (#211)', async () => {
        const { svc, view_manager } = setup();
        svc.now = () => Date.UTC(2026, 10, 25);
        const v = await svc.create(ACCT, {
            file_id: 11,
            name: 'Due',
            type: 'calendar',
            calendar: { date_field: 'd', title_field: 'a' }
        });
        view_manager.find_rows.mockResolvedValue([
            { _id: 'r1', row_index: 1, a: 'Ship', d: new Date('2026-11-20T00:00:00Z') }
        ]);
        const cal = await svc.calendar(ACCT, v.id, undefined, undefined);
        expect(cal).toMatchObject({
            date_field: 'd',
            title_field: 'a',
            from: '2026-11-01',
            to: '2026-12-01',
            events: [{ _id: 'r1', date: '2026-11-20', time: null, title: 'Ship' }],
            truncated: false
        });
        const [, file_id, filter, sort, limit] = view_manager.find_rows.mock.calls[0];
        expect(file_id).toBe(11);
        expect(filter).toEqual({
            d: { $gte: new Date('2026-11-01T00:00:00Z'), $lt: new Date('2026-12-01T00:00:00Z') }
        });
        expect(sort).toEqual({ d: 1, _id: 1 });
        expect(limit).toBe(VIEW_LIMITS.max_calendar_rows + 1);
        expect((await svc.calendar(ACCT, v.id, '2026-12-01', '2027-01-01')).from).toBe(
            '2026-12-01'
        );
        await expect(svc.calendar(ACCT, v.id, '2026-12-01', 'soon')).rejects.toThrow(
            BadRequestException
        );
        await expect(svc.calendar(OTHER, v.id, undefined, undefined)).rejects.toThrow(
            NotFoundException
        );
        await expect(svc.map(ACCT, v.id)).rejects.toThrow(BadRequestException);
    });

    it('reads a map, counting rows without a place (#211)', async () => {
        const { svc, view_manager } = setup();
        const v = await svc.create(ACCT, {
            file_id: 11,
            name: 'Places',
            type: 'map',
            map: { lat_field: 'c', lng_field: 'e', label_field: 'a' }
        });
        view_manager.find_rows.mockResolvedValue([
            { _id: 'r1', row_index: 1, a: 'London', c: 51.5, e: -0.12 }
        ]);
        view_manager.count_rows.mockResolvedValueOnce(3).mockResolvedValueOnce(1);
        expect(await svc.map(ACCT, v.id)).toEqual({
            lat_field: 'c',
            lng_field: 'e',
            label_field: 'a',
            points: [{ _id: 'r1', lat: 51.5, lng: -0.12, label: 'London' }],
            truncated: false,
            missing: 2
        });
        await expect(svc.map(OTHER, v.id)).rejects.toThrow(NotFoundException);
        await expect(svc.calendar(ACCT, v.id, undefined, undefined)).rejects.toThrow(
            BadRequestException
        );
    });
});
