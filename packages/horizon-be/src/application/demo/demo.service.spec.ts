jest.mock('uuid', () => ({ v4: () => jest.requireActual('crypto').randomUUID() }));

import { DemoService } from './demo.service';
import { view_body } from './demo-seed.service';
import { NoDemoGuard, is_write } from '@app/web/http/_auth/demo.guard';
import { Session } from '@app/core/session/session.entity';
import { Account } from '@app/core/account/account.entity';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 28, 12);

function make(opts: { live?: number; seed_fails?: boolean } = {}) {
    let next_id = 100;
    const saved: any[] = [];
    const account_repository = {
        countBy: jest.fn(async () => opts.live ?? 0),
        save: jest.fn(async (a: any) => {
            const row = { ...a, id: next_id++ };
            saved.push(row);
            return row;
        }),
        update: jest.fn(async () => undefined),
        find: jest.fn(async () => []),
        findOne: jest.fn(async () => null)
    };
    const session_repository = { delete: jest.fn(async () => undefined) };
    const session_manager = {
        create_session: jest.fn(async (id: number) => ({
            token: `internal_t${id}`,
            account_id: id
        }))
    };
    const seed_svc = {
        seed: jest.fn(async () => {
            if (opts.seed_fails) throw new Error('seed failed');
            return { tables: [1, 2, 3, 4] };
        })
    };
    const deletion = { delete_account: jest.fn(async () => undefined) };
    const svc = new DemoService(
        account_repository as any,
        session_repository as any,
        session_manager as any,
        seed_svc as any,
        deletion as any
    );
    svc.now = () => NOW;
    return {
        svc,
        account_repository,
        session_repository,
        session_manager,
        seed_svc,
        deletion,
        saved
    };
}

describe('DemoService (#333)', () => {
    const prev = process.env.HORIZON_DEMO_MAX_LIVE;
    afterEach(() => {
        if (prev === undefined) delete process.env.HORIZON_DEMO_MAX_LIVE;
        else process.env.HORIZON_DEMO_MAX_LIVE = prev;
    });

    it('makes a filled demo account with no password and answers its session', async () => {
        const m = make();
        const res = await m.svc.create('1.2.3.4');
        expect(res.token).toBe('internal_t100');
        expect(res.expires_at).toBe(new Date(NOW + 24 * HOUR).toISOString());
        const account = m.saved[0];
        expect(account.email).toMatch(/@demo\.invalid$/);
        expect(account.password_hash).toBeNull();
        expect(account.email_verified).toBe(true);
        expect(account.demo_expires_at.getTime()).toBe(NOW + 24 * HOUR);
        expect(m.seed_svc.seed).toHaveBeenCalledWith(account);
        expect(m.session_manager.create_session).toHaveBeenCalledWith(100);
    });

    it('makes 3 per IP a day, then answers 429', async () => {
        const m = make();
        for (let i = 0; i < 3; i++) await m.svc.create('1.2.3.4');
        await expect(m.svc.create('1.2.3.4')).rejects.toMatchObject({ status: 429 });
        // Refused tries make nothing
        expect(m.saved.length).toBe(3);
        await m.svc.create('5.6.7.8');
        expect(m.saved.length).toBe(4);
    });

    it('answers 503 once the server has as many live demos as it takes', async () => {
        const m = make({ live: 50 });
        await expect(m.svc.create('1.2.3.4')).rejects.toMatchObject({ status: 503 });
        expect(m.saved.length).toBe(0);
        process.env.HORIZON_DEMO_MAX_LIVE = '60';
        await m.svc.create('1.2.3.4');
        expect(m.saved.length).toBe(1);
    });

    it('deletes an account whose seed failed, and gives no session', async () => {
        const m = make({ seed_fails: true });
        await expect(m.svc.create('1.2.3.4')).rejects.toThrow('seed failed');
        expect(m.account_repository.update).toHaveBeenCalledWith({ id: 100 }, { deleted: true });
        expect(m.session_repository.delete).toHaveBeenCalledWith({ account_id: 100 });
        expect(m.deletion.delete_account).toHaveBeenCalledWith(100);
        expect(m.session_manager.create_session).not.toHaveBeenCalled();
        // The next request isn't stuck behind it
        m.seed_svc.seed.mockResolvedValueOnce({ tables: [] });
        await expect(m.svc.create('5.6.7.8')).resolves.toHaveProperty('token');
    });

    it('makes one at a time, so parallel requests see each other in the live count', async () => {
        const m = make();
        let live = 0;
        m.account_repository.countBy.mockImplementation(async () => live);
        m.account_repository.save.mockImplementation(async (a: any) => {
            live++;
            return { ...a, id: 100 + live };
        });
        process.env.HORIZON_DEMO_MAX_LIVE = '2';
        const results = await Promise.allSettled([
            m.svc.create('1.1.1.1'),
            m.svc.create('2.2.2.2'),
            m.svc.create('3.3.3.3')
        ]);
        expect(results.map(r => r.status)).toEqual(['fulfilled', 'fulfilled', 'rejected']);
    });

    it('sweeps expired demo accounts through AccountDeletionService', async () => {
        const m = make();
        m.account_repository.find.mockResolvedValueOnce([
            { id: 7, demo_expires_at: new Date(NOW - HOUR) },
            { id: 8, demo_expires_at: new Date(NOW + HOUR) }
        ]);
        expect(await m.svc.sweep()).toEqual([7]);
        expect(m.account_repository.update).toHaveBeenCalledWith({ id: 7 }, { deleted: true });
        expect(m.session_repository.delete).toHaveBeenCalledWith({ account_id: 7 });
        expect(m.deletion.delete_account).toHaveBeenCalledWith(7);
        expect(m.deletion.delete_account).toHaveBeenCalledTimes(1);
    });

    it('keeps sweeping when one deletion fails', async () => {
        const m = make();
        m.account_repository.find.mockResolvedValueOnce([
            { id: 7, demo_expires_at: new Date(NOW - 2 * HOUR) },
            { id: 9, demo_expires_at: new Date(NOW - HOUR) }
        ]);
        m.deletion.delete_account.mockRejectedValueOnce(new Error('mongo down'));
        expect(await m.svc.sweep()).toEqual([9]);
    });
});

describe('NoDemoGuard (#333)', () => {
    const context = (method: string, user: any) =>
        ({ switchToHttp: () => ({ getRequest: () => ({ method, user }) }) }) as any;
    const session = (account_id: number) => Object.assign(new Session(), { account_id });

    it('refuses a demo account a write with 403 demo_account', async () => {
        const demo = { is_demo: jest.fn(async (id: number) => id === 1) };
        const guard = new NoDemoGuard(demo as any);
        await expect(guard.canActivate(context('POST', session(1)))).rejects.toMatchObject({
            status: 403,
            response: { code: 'demo_account' }
        });
        await expect(guard.canActivate(context('DELETE', session(1)))).rejects.toMatchObject({
            status: 403
        });
        await expect(guard.canActivate(context('POST', session(2)))).resolves.toBe(true);
    });

    it('lets reads through without looking the account up', async () => {
        const demo = { is_demo: jest.fn(async () => true) };
        const guard = new NoDemoGuard(demo as any);
        await expect(guard.canActivate(context('GET', session(1)))).resolves.toBe(true);
        expect(demo.is_demo).not.toHaveBeenCalled();
        expect(is_write('GET')).toBe(false);
        expect(is_write('head')).toBe(false);
        expect(is_write('PUT')).toBe(true);
    });

    it("refuses a demo account's API key", async () => {
        const guard = new NoDemoGuard({ is_demo: jest.fn() } as any);
        const key_account = Object.assign(new Account(), {
            id: 1,
            demo_expires_at: new Date(NOW)
        });
        await expect(guard.canActivate(context('POST', key_account))).rejects.toMatchObject({
            status: 403
        });
        const other = Object.assign(new Account(), { id: 2, demo_expires_at: null });
        await expect(guard.canActivate(context('POST', other))).resolves.toBe(true);
    });
});

describe('view_body (#333)', () => {
    it('names columns by their fields, as POST /view takes them', () => {
        const table = {
            id: 5,
            fields: new Map([
                ['Total', 'a'],
                ['Month', 'b'],
                ['Lat', 'c'],
                ['Lng', 'd'],
                ['Name', 'e']
            ])
        };
        expect(
            view_body(
                {
                    table: 'orders',
                    name: 'Revenue',
                    type: 'chart',
                    chart: { kind: 'bar', group: 'Month', agg: 'sum', value: 'Total' }
                },
                table
            )
        ).toEqual({
            file_id: 5,
            name: 'Revenue',
            type: 'chart',
            chart: { kind: 'bar', group_field: 'b', agg: 'sum', value_field: 'a' }
        });
        expect(
            view_body(
                {
                    table: 'orders',
                    name: 'Big',
                    type: 'grid',
                    filters: [{ column: 'Total', type: 'greaterThan', value: '400' }],
                    sort: { column: 'Total', dir: 'desc' }
                },
                table
            )
        ).toEqual({
            file_id: 5,
            name: 'Big',
            type: 'grid',
            filters: [{ field: 'a', type: 'greaterThan', value: '400' }],
            sort: { field: 'a', dir: 'desc' }
        });
        expect(
            view_body(
                {
                    table: 'customers',
                    name: 'Map',
                    type: 'map',
                    map: { lat: 'Lat', lng: 'Lng', label: 'Name' }
                },
                table
            ).map
        ).toEqual({ lat_field: 'c', lng_field: 'd', label_field: 'e' });
    });
});
