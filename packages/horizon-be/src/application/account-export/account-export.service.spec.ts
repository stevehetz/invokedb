import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Writable } from 'stream';
import env from '@app/env';
import { AccountExportService } from './account-export.service';
import { EXPORT_JOB_EVENT, EXPORT_LIMITS } from '@app/core/account-export/account-export';

jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));
// Stand-ins below; the real ones pull in TypeORM and ESM-only packages
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../web-file/web-file-prc-notify.service', () => ({}));
// The zip format has its own tests: here each entry is just collected as text
jest.mock('@app/core/account-export/zip-writer', () => ({
    ZipWriter: class {
        bytes = 0;
        constructor(private out: any) {}
        async add(name: string, source: any) {
            let text = '';
            if (typeof source === 'string') text = source;
            else for await (const c of source) text += c;
            this.out.entries = this.out.entries || {};
            this.out.entries[name] = text;
            this.bytes += text.length;
        }
        async finish() {}
    }
}));

const ACCT = 7;
const OTHER = 8;

async function* rows_of(list: any[]) {
    for (const r of list) yield r;
}

function setup() {
    const records: any[] = [];
    const jobs: any[] = [];
    const export_manager = {
        create: jest.fn(async e => records.push({ ...e })),
        get: jest.fn(
            async (acct, id) => records.find(r => r.account_id === acct && r.id === id) || null
        ),
        latest: jest.fn(async acct => {
            const mine = records.filter(r => r.account_id === acct);
            return mine.sort((a, b) => b.created_at - a.created_at)[0] || null;
        }),
        count_since: jest.fn(
            async (acct, since) =>
                records.filter(r => r.account_id === acct && r.created_at >= since).length
        ),
        update: jest.fn(async (acct, id, changes) => {
            const r = records.find(x => x.account_id === acct && x.id === id);
            if (r) Object.assign(r, changes);
        }),
        expired: jest.fn(async now =>
            records.filter(r => r.status === 'ready' && r.expires_at <= now)
        )
    };
    const job_manager = {
        create: jest.fn(async j => jobs.push(j)),
        update: jest.fn(async () => undefined)
    };
    const files = [
        { id: 1, account_id: ACCT, name: 'HR', type: 'dir', parent_id: null },
        { id: 2, account_id: ACCT, name: 'People', type: 'file', parent_id: 1 },
        { id: 3, account_id: ACCT, name: 'Teams', type: 'file', parent_id: null }
    ];
    const file_directory_svc = {
        get_by_account_id: jest.fn(async acct => files.filter(f => f.account_id === acct))
    };
    const cols = {
        2: [
            { field: 'a', headerName: 'Name', order: 1 },
            { field: 'b', headerName: 'Team', col_type: 'link', link_table_id: 3, order: 2 }
        ],
        3: [{ field: 'a', headerName: 'Team name', order: 1 }]
    };
    const rows = {
        2: [
            { _id: 'p1', a: 'Ada', b: ['t1'] },
            { _id: 'p2', a: 'Grace', b: null }
        ],
        3: [{ _id: 't1', a: 'Engines' }]
    };
    const web_file_manager = { get_columns: jest.fn(async (_acct, id) => cols[id] || []) };
    const collections = {
        get_dg_row: jest.fn(async (_acct, id) => ({
            find: () => ({ sort: () => ({ batchSize: () => rows_of(rows[id] || []) }) })
        }))
    };
    const view_manager = {
        list: jest.fn(async (acct, file_id) =>
            acct === ACCT && file_id === 2
                ? [{ id: 'v1', account_id: ACCT, file_id: 2, name: 'All', type: 'grid' }]
                : []
        )
    };
    const webhook_manager = {
        list: jest.fn(async acct =>
            acct === ACCT
                ? [
                      {
                          id: 'w1',
                          account_id: ACCT,
                          file_id: null,
                          url: 'https://example.com/h',
                          events: ['row.created'],
                          secret: 'whsec_topsecret'
                      }
                  ]
                : []
        )
    };
    const notify = { wake_processor: jest.fn() };
    const service = new AccountExportService(
        export_manager as any,
        job_manager as any,
        file_directory_svc as any,
        web_file_manager as any,
        view_manager as any,
        webhook_manager as any,
        collections as any,
        notify as any
    );
    return { service, records, jobs, export_manager, job_manager, notify };
}

describe('AccountExportService', () => {
    let share: string;
    const old_share = env.HORIZON_FILE_SHARE;

    beforeEach(() => {
        share = fs.mkdtempSync(path.join(os.tmpdir(), 'export-spec-'));
        env.HORIZON_FILE_SHARE = share;
    });

    afterEach(() => {
        env.HORIZON_FILE_SHARE = old_share;
        fs.rmSync(share, { recursive: true, force: true });
    });

    it('queues an export as a job for the processor', async () => {
        const { service, jobs, notify } = setup();
        const { export: e } = await service.request(ACCT);
        expect(e.status).toBe('pending');
        expect(e).not.toHaveProperty('account_id');
        expect(jobs).toEqual([
            expect.objectContaining({
                account_id: ACCT,
                file_id: null,
                event: EXPORT_JOB_EVENT,
                status: 'PENDING',
                data: { export_id: e.id }
            })
        ]);
        expect(notify.wake_processor).toHaveBeenCalled();
        expect((await service.status(ACCT)).export.id).toBe(e.id);
        expect((await service.status(OTHER)).export).toBeNull();
    });

    it('refuses a second export while one is being prepared', async () => {
        const { service } = setup();
        await service.request(ACCT);
        await expect(service.request(ACCT)).rejects.toBeInstanceOf(ConflictException);
        // Another account isn't held up
        await expect(service.request(OTHER)).resolves.toBeTruthy();
    });

    it('allows a few exports a day', async () => {
        const { service, records } = setup();
        for (let i = 0; i < EXPORT_LIMITS.max_per_window; i++) {
            await service.request(ACCT);
            records[records.length - 1].status = 'ready';
        }
        const err = await service.request(ACCT).catch(e => e);
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(429);
    });

    it('writes every table as CSV and JSON, and the settings without secrets', async () => {
        const { service } = setup();
        const out: any = new Writable({ write: (_c, _e, cb) => cb() });
        out.entries = {};
        const totals = await service.write_entries(ACCT, out);
        const entries = out.entries;
        expect(Object.keys(entries).sort()).toEqual([
            'manifest.json',
            'tables/HR/People.csv',
            'tables/HR/People.json',
            'tables/Teams.csv',
            'tables/Teams.json',
            'views.json',
            'webhooks.json'
        ]);
        expect(totals).toMatchObject({ tables: 2, rows: 3 });

        expect(entries['tables/HR/People.csv']).toBe('_id,Name,Team\r\np1,Ada,t1\r\np2,Grace,\r\n');
        const people = JSON.parse(entries['tables/HR/People.json']);
        expect(people.columns).toEqual([
            { name: 'Name', type: 'string' },
            { name: 'Team', type: 'link', link_table_id: 3, link_table: 'Teams' }
        ]);
        expect(people.rows).toEqual([
            { _id: 'p1', Name: 'Ada', Team: ['t1'] },
            { _id: 'p2', Name: 'Grace', Team: null }
        ]);
        expect(people.folders).toEqual(['HR']);

        expect(JSON.parse(entries['views.json'])[0]).toMatchObject({ id: 'v1', table: 'People' });
        expect(entries['webhooks.json']).not.toContain('topsecret');
        expect(JSON.parse(entries['webhooks.json'])[0]).toMatchObject({ id: 'w1', table: null });

        const m = JSON.parse(entries['manifest.json']);
        expect(m.tables.map(t => [t.name, t.rows, t.csv])).toEqual([
            ['People', 2, 'tables/HR/People.csv'],
            ['Teams', 1, 'tables/Teams.csv']
        ]);
    });

    it('runs the job: writes the zip to the file share and marks it ready for 24 hours', async () => {
        const { service, job_manager } = setup();
        const { export: e } = await service.request(ACCT);
        // The mocked writer gives the stream nothing to write; the real one is tested apart
        await service.run({ id: 1, account_id: ACCT, data: { export_id: e.id }, restarts: 0 });
        const { export: done } = await service.status(ACCT);
        expect(done.status).toBe('ready');
        expect(done.tables).toBe(2);
        expect(done.expires_at - done.finished_at).toBe(EXPORT_LIMITS.keep_ms);
        expect(job_manager.update).toHaveBeenCalledWith(1, { status: 'COMPLETE' });

        const file = await service.download(ACCT, e.id);
        expect(file.file_path).toBe(path.join(share, 'exports', `${e.id}.zip`));
        expect(fs.existsSync(file.file_path)).toBe(true);
        expect(fs.existsSync(`${file.file_path}.part`)).toBe(false);
        expect(file.name).toMatch(/^invokedb-export-\d{4}-\d{2}-\d{2}\.zip$/);
    });

    it("doesn't let another account download it", async () => {
        const { service } = setup();
        const { export: e } = await service.request(ACCT);
        await service.run({ id: 1, account_id: ACCT, data: { export_id: e.id }, restarts: 0 });
        await expect(service.download(OTHER, e.id)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.download(ACCT, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("doesn't run another account's export from a job naming it", async () => {
        const { service, job_manager } = setup();
        const { export: e } = await service.request(ACCT);
        await service.run({ id: 2, account_id: OTHER, data: { export_id: e.id }, restarts: 0 });
        expect(job_manager.update).toHaveBeenCalledWith(
            2,
            expect.objectContaining({ status: 'ERROR' })
        );
        expect((await service.status(ACCT)).export.status).toBe('pending');
    });

    it('refuses a download before it is ready and after it expires, and removes the zip', async () => {
        const { service, records } = setup();
        const { export: e } = await service.request(ACCT);
        const gone = (p: Promise<any>) => p.catch(x => x.getStatus());
        expect(await gone(service.download(ACCT, e.id))).toBe(410);

        await service.run({ id: 1, account_id: ACCT, data: { export_id: e.id }, restarts: 0 });
        const record = records.find(r => r.id === e.id);
        const zip = path.join(share, 'exports', `${e.id}.zip`);
        expect(fs.existsSync(zip)).toBe(true);

        record.expires_at = Date.now() - 1;
        expect(await gone(service.download(ACCT, e.id))).toBe(410);
        expect((await service.status(ACCT)).export.status).toBe('expired');

        expect(await service.remove_expired(Date.now())).toBe(1);
        expect(fs.existsSync(zip)).toBe(false);
        expect(record.status).toBe('expired');
    });

    it('marks the export failed when the job has restarted too often', async () => {
        const { service } = setup();
        const { export: e } = await service.request(ACCT);
        await service.run({ id: 1, account_id: ACCT, data: { export_id: e.id }, restarts: 99 });
        const { export: failed } = await service.status(ACCT);
        expect(failed.status).toBe('error');
        expect(failed.error).toBeTruthy();
        expect(fs.existsSync(path.join(share, 'exports', `${e.id}.zip.part`))).toBe(false);
    });
});
