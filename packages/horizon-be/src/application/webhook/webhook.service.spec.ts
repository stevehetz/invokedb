import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { PLANS, PLAN_IDS, PLAN_SUBSCRIPTIONS, PlanId } from '@app/core/plan/plans';

jest.mock('@app/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
// Stand-ins below; the real ones pull in TypeORM and ESM-only packages
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));

const ACCT = 7;
const OTHER = 8;

// The accounts are on Pro unless a test says otherwise, so the tests can make several webhooks
function setup(plan_id: PlanId = 'PRO') {
    const hooks: any[] = [];
    const deliveries: any[] = [];
    const files = {
        11: { id: 11, account_id: ACCT, name: 'people', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'theirs', type: 'file', deleted: false }
    };
    const file_directory_svc = {
        get_by_id: jest.fn(async id => files[id] || null),
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
    const tracking_manager = {
        check_account_lock: jest.fn(async () => undefined),
        check_not_read_only: jest.fn(async () => undefined)
    };
    const web_file_manager = {
        get_all: jest.fn(async () => ({
            data: [
                { field: 'a', headerName: 'name' },
                { field: 'b', headerName: 'joined' }
            ]
        })),
        format_date_field: jest.fn(() => '2020-01-02 12:00:00 AM')
    };
    const webhook_manager = {
        list: jest.fn(async acct => hooks.filter(h => h.account_id === acct)),
        count: jest.fn(async acct => hooks.filter(h => h.account_id === acct).length),
        get: jest.fn(async (acct, id) => hooks.find(h => h.account_id === acct && h.id === id)),
        matching: jest.fn(async (acct, file_id, event) =>
            hooks.filter(
                h =>
                    h.account_id === acct &&
                    h.enabled &&
                    h.events.includes(event) &&
                    (h.file_id === null || h.file_id === file_id)
            )
        ),
        create: jest.fn(async h => (hooks.push(h), h)),
        update: jest.fn(),
        remove: jest.fn(async (acct, id) => {
            const i = hooks.findIndex(h => h.account_id === acct && h.id === id);
            if (i >= 0) hooks.splice(i, 1);
        }),
        add_deliveries: jest.fn(async list => deliveries.push(...list)),
        deliveries: jest.fn(async () => [])
    };
    const svc = new WebhookService(
        file_directory_svc as any,
        account_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        webhook_manager as any
    );
    return { svc, hooks, deliveries, webhook_manager };
}

describe('WebhookService', () => {
    it('creates a webhook for a table, with a secret', async () => {
        const { svc, hooks } = setup();
        const hook = await svc.create(ACCT, {
            url: 'https://hooks.example.com/in',
            events: ['row.created'],
            file_id: 11
        });
        expect(hook).toMatchObject({ file_id: 11, enabled: true, events: ['row.created'] });
        expect(hook.secret).toMatch(/^whsec_/);
        expect(hook).not.toHaveProperty('account_id');
        expect(hooks[0].account_id).toBe(ACCT);
    });

    it('refuses private URLs, bad events and another account’s table', async () => {
        const { svc, hooks } = setup();
        const body = { url: 'https://hooks.example.com/in', events: ['row.created'] };
        await expect(svc.create(ACCT, { ...body, url: 'http://127.0.0.1/x' })).rejects.toThrow(
            BadRequestException
        );
        await expect(svc.create(ACCT, { ...body, events: ['nope'] })).rejects.toThrow(
            BadRequestException
        );
        await expect(svc.create(ACCT, { ...body, file_id: 12 })).rejects.toThrow(
            ForbiddenException
        );
        expect(hooks).toHaveLength(0);
    });

    describe.each(PLAN_IDS)('on %s', plan_id => {
        it("caps the webhooks per account at the plan's", async () => {
            const { svc } = setup(plan_id);
            const body = { url: 'https://hooks.example.com/in', events: ['row.created'] };
            const cap = PLANS[plan_id].caps.webhooks;
            for (let i = 0; i < cap; i++) await svc.create(ACCT, body);
            const err = await svc.create(ACCT, body).catch(e => e);
            expect(err.getStatus()).toBe(403);
            expect(err.getResponse()).toMatchObject({ code: 'plan_limit', limit: 'webhooks', cap });
            // Another account has its own allowance
            await expect(svc.create(OTHER, body)).resolves.toBeTruthy();
        });
    });

    it("can't read, change, test or delete another account's webhook", async () => {
        const { svc } = setup();
        const hook = await svc.create(ACCT, {
            url: 'https://hooks.example.com/in',
            events: ['row.created']
        });
        await expect(svc.update(OTHER, hook.id, { enabled: false })).rejects.toThrow(
            NotFoundException
        );
        await expect(svc.test(OTHER, hook.id)).rejects.toThrow(NotFoundException);
        await expect(svc.deliveries(OTHER, hook.id)).rejects.toThrow(NotFoundException);
        await expect(svc.remove(OTHER, hook.id)).rejects.toThrow(NotFoundException);
        expect((await svc.list(OTHER)).webhooks).toHaveLength(0);
        expect((await svc.list(ACCT)).webhooks).toHaveLength(1);
    });

    it('queues one delivery per matching webhook, with rows by column name', async () => {
        const { svc, deliveries } = setup();
        const url = 'https://hooks.example.com/in';
        const table_hook = await svc.create(ACCT, { url, events: ['row.created'], file_id: 11 });
        const all_hook = await svc.create(ACCT, { url, events: ['row.created', 'row.deleted'] });
        await svc.create(ACCT, { url, events: ['row.updated'], file_id: 11 });
        await svc.create(ACCT, { url, events: ['row.created'], enabled: false });
        await svc.create(OTHER, { url, events: ['row.created'] });

        const joined = new Date('2020-01-02T00:00:00Z');
        await svc.emit(ACCT, 11, 'row.created', [
            { _id: 'r1', a: 'alice', b: joined, row_index: 1 }
        ]);
        expect(deliveries.map(d => d.webhook_id).sort()).toEqual(
            [table_hook.id, all_hook.id].sort()
        );
        const payload = JSON.parse(deliveries[0].body);
        expect(payload).toMatchObject({
            event: 'row.created',
            table: { id: 11, name: 'people' },
            rows: [{ _id: 'r1', name: 'alice', joined: '2020-01-02 12:00:00 AM' }]
        });
        expect(payload.id).toBe(deliveries[0].id);
        expect(deliveries[0]).toMatchObject({ status: 'pending', attempts: 0, account_id: ACCT });
    });

    it('sends deletes as ids and splits big changes', async () => {
        const { svc, deliveries } = setup();
        await svc.create(ACCT, { url: 'https://h.example.com/', events: ['row.deleted'] });
        const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
        await svc.emit(ACCT, 11, 'row.deleted', ids);
        expect(deliveries.map(d => d.rows)).toEqual([100, 50]);
        expect(JSON.parse(deliveries[1].body).rows[0]).toEqual({ _id: 'id100' });
    });

    it('queues nothing without a matching webhook, and never throws', async () => {
        const { svc, deliveries, webhook_manager } = setup();
        await svc.emit(ACCT, 11, 'row.created', [{ _id: 'r1' }]);
        await svc.emit(ACCT, 11, 'row.created', []);
        expect(deliveries).toHaveLength(0);
        webhook_manager.matching.mockRejectedValueOnce(new Error('mongo down'));
        await expect(svc.emit(ACCT, 11, 'row.created', [{ _id: 'r1' }])).resolves.toBeUndefined();
    });

    it("queues a ping for the test event, and drops a deleted table's webhooks", async () => {
        const { svc, deliveries, hooks } = setup();
        const hook = await svc.create(ACCT, {
            url: 'https://h.example.com/',
            events: ['row.created'],
            file_id: 11
        });
        const sent = await svc.test(ACCT, hook.id);
        expect(sent.event).toBe('ping');
        expect(sent.payload).toMatchObject({ event: 'ping', table: { id: 11 }, rows: [] });
        expect(deliveries).toHaveLength(1);

        hooks[0].file_id = 99; // its table is gone
        expect((await svc.list(ACCT)).webhooks).toHaveLength(0);
        expect(hooks).toHaveLength(0);
    });
});
