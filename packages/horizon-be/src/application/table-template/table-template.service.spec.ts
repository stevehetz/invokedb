import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { TableTemplateService } from './table-template.service';
import { validate_template } from '@app/core/table-template/table-template';

jest.mock('@app/logger', () => ({ __esModule: true, default: { error: jest.fn() } }));
// The services are passed in as stubs below; don't load their modules (and their ESM deps)
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../web-file/web-file.service', () => ({}));
jest.mock('../account/account.service', () => ({}));

const template = validate_template('things', {
    name: 'Things',
    description: '',
    table_name: 'things',
    columns: [
        { name: 'Name', type: 'string' },
        { name: 'Count', type: 'number' }
    ],
    rows: [{ Name: 'cup', Count: 3 }]
});

function setup(account: any = { id: 4, locked: false }) {
    const file_directory_svc = {
        create: jest.fn(async () => ({ id: 99 })),
        batch_delete: jest.fn(async () => 'done')
    };
    const web_file_svc = { batch_create_internal: jest.fn(async () => undefined) };
    const account_svc = { get: jest.fn(async () => account) };
    const web_file_manager = { batch_create: jest.fn(async () => 2) };
    const tracking_manager = {
        check_account_lock: jest.fn(async acct => {
            if (acct.locked) throw new HttpException('Account locked', HttpStatus.FORBIDDEN);
        })
    };
    const service = new TableTemplateService(
        file_directory_svc as any,
        web_file_svc as any,
        account_svc as any,
        web_file_manager as any,
        tracking_manager as any
    );
    (service as any).templates = [template];
    return { service, file_directory_svc, web_file_svc, web_file_manager };
}

describe('TableTemplateService', () => {
    it('lists templates without their sample rows', () => {
        const { service } = setup();
        expect(service.list()).toEqual([
            {
                id: 'things',
                name: 'Things',
                description: '',
                table_name: 'things',
                columns: template.columns,
                row_count: 1
            }
        ]);
    });

    it("creates the table in the caller's account, then its columns and rows", async () => {
        const { service, file_directory_svc, web_file_svc, web_file_manager } = setup();
        await expect(
            service.create(4, 'things', { name: 'my_things', parent_id: 12 })
        ).resolves.toBe(99);
        expect(file_directory_svc.create).toHaveBeenCalledWith(
            4,
            { name: 'my_things', parent_id: 12, type: 'file', web_file_type: 'data-grid' },
            true
        );
        const cols = (web_file_manager.batch_create.mock.calls[0] as any[])[3];
        expect(cols.map(c => [c.field, c.headerName, c.col_type])).toEqual([
            ['a', 'Name', 'string'],
            ['b', 'Count', 'number']
        ]);
        expect(web_file_svc.batch_create_internal).toHaveBeenCalledWith(
            { id: 4, locked: false },
            99,
            'data_grid_row',
            [{ a: 'cup', b: 3 }]
        );
    });

    it("uses the template's table name when none is given", async () => {
        const { service, file_directory_svc } = setup();
        await service.create(4, 'things', {});
        expect((file_directory_svc.create.mock.calls[0] as any[])[1].name).toBe('things');
    });

    it('rejects an unknown template', async () => {
        const { service, file_directory_svc } = setup();
        await expect(service.create(4, 'nope', {})).rejects.toBeInstanceOf(NotFoundException);
        expect(file_directory_svc.create).not.toHaveBeenCalled();
    });

    it('rejects a bad table name before creating anything', async () => {
        const { service, file_directory_svc } = setup();
        await expect(service.create(4, 'things', { name: 'a b' })).rejects.toMatchObject({
            status: HttpStatus.BAD_REQUEST
        });
        expect(file_directory_svc.create).not.toHaveBeenCalled();
    });

    it('rejects a locked account', async () => {
        const { service, file_directory_svc } = setup({ id: 4, locked: true });
        await expect(service.create(4, 'things', {})).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN
        });
        expect(file_directory_svc.create).not.toHaveBeenCalled();
    });

    it('writes nothing when the table limit is reached', async () => {
        const { service, file_directory_svc, web_file_manager } = setup();
        file_directory_svc.create.mockRejectedValueOnce(
            new HttpException('Table limit exceeded', HttpStatus.FORBIDDEN)
        );
        await expect(service.create(4, 'things', {})).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN
        });
        expect(web_file_manager.batch_create).not.toHaveBeenCalled();
    });

    it('deletes the new table again when the rows go over the row limit', async () => {
        const { service, file_directory_svc, web_file_svc } = setup();
        web_file_svc.batch_create_internal.mockRejectedValueOnce(
            new HttpException('Row count limit exceeded', HttpStatus.FORBIDDEN)
        );
        await expect(service.create(4, 'things', {})).rejects.toMatchObject({
            status: HttpStatus.FORBIDDEN
        });
        expect(file_directory_svc.batch_delete).toHaveBeenCalledWith(
            { id: 4, locked: false },
            { ids: [99] }
        );
    });
});
