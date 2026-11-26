import {
    BadRequestException,
    ForbiddenException,
    GoneException,
    HttpException,
    NotFoundException
} from '@nestjs/common';
import { FORM_CLOSED, FORM_NOT_FOUND, FORM_UNAVAILABLE, FormService } from './form.service';
import { HONEYPOT_FIELD } from '@app/core/form/form';
import { PLANS, PLAN_IDS, PLAN_SUBSCRIPTIONS, PlanId } from '@app/core/plan/plans';

jest.mock('@app/logger', () => ({
    __esModule: true,
    default: { error: jest.fn(), info: jest.fn() }
}));
// Stand-ins below; the real ones pull in TypeORM and ESM-only packages
jest.mock('../file-directory/file-directory.service', () => ({}));
jest.mock('../account/account.service', () => ({}));
jest.mock('../web-file/web-file.service', () => ({}));

const ACCT = 7;
const OTHER = 8;

// The account is on Pro unless a test says otherwise, so the tests can make several forms
function setup(plan_id: PlanId = 'PRO') {
    const forms: any[] = [];
    const rows: any[] = [];
    const files = {
        11: { id: 11, account_id: ACCT, name: 'people', type: 'file', deleted: false },
        12: { id: 12, account_id: OTHER, name: 'theirs', type: 'file', deleted: false },
        13: { id: 13, account_id: ACCT, name: 'gone', type: 'file', deleted: true }
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
    const tracking_manager = { check_account_lock: jest.fn(async () => undefined) };
    const web_file_manager = {
        get_all: jest.fn(async () => ({
            data: [
                { field: 'a', headerName: 'name', order: 1 },
                { field: 'b', headerName: 'age', col_type: 'number', order: 2 }
            ]
        }))
    };
    const web_file_svc = {
        batch_create_internal: jest.fn(async (account, file_id, type, data) => {
            rows.push({ account_id: account.id, file_id, type, data });
        })
    };
    const form_manager = {
        list: jest.fn(async (acct, file_id) =>
            forms.filter(f => f.account_id === acct && (!file_id || f.file_id === file_id))
        ),
        count: jest.fn(async acct => forms.filter(f => f.account_id === acct).length),
        get: jest.fn(async (acct, id) => forms.find(f => f.account_id === acct && f.id === id)),
        get_public: jest.fn(async id => forms.find(f => f.id === id) || null),
        create: jest.fn(async f => (forms.push(f), f)),
        update: jest.fn(async (acct, id, changes) => {
            const f = forms.find(x => x.account_id === acct && x.id === id);
            Object.assign(f, changes);
            return f;
        }),
        remove: jest.fn(async (acct, id) => {
            const i = forms.findIndex(f => f.account_id === acct && f.id === id);
            if (i >= 0) forms.splice(i, 1);
        }),
        submitted: jest.fn(async f => {
            f.submissions++;
        })
    };
    const svc = new FormService(
        file_directory_svc as any,
        account_svc as any,
        web_file_svc as any,
        tracking_manager as any,
        web_file_manager as any,
        form_manager as any
    );
    return { svc, forms, rows, files, form_manager, web_file_svc, tracking_manager };
}

const NEW_FORM = {
    file_id: 11,
    title: 'Sign up',
    fields: [{ field: 'a', required: true }, { field: 'b' }],
    thank_you: 'Thanks!'
};

const status_of = async (p: Promise<unknown>) => {
    try {
        await p;
        return 200;
    } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        return (ex as HttpException).getStatus();
    }
};

describe('FormService (owner)', () => {
    it('creates a form on one of the account’s tables', async () => {
        const { svc, forms } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        expect(form.id).toMatch(/^form_[0-9a-f]{24}$/);
        expect(form.file_id).toBe(11);
        expect(form.open).toBe(true);
        expect(form.submissions).toBe(0);
        expect(form).not.toHaveProperty('account_id');
        expect(forms[0].account_id).toBe(ACCT);
    });

    it('refuses another account’s table, a deleted table and bad settings', async () => {
        const { svc } = setup();
        await expect(svc.create(ACCT, { ...NEW_FORM, file_id: 12 })).rejects.toBeInstanceOf(
            ForbiddenException
        );
        await expect(svc.create(ACCT, { ...NEW_FORM, file_id: 13 })).rejects.toBeInstanceOf(
            NotFoundException
        );
        await expect(svc.create(ACCT, { ...NEW_FORM, file_id: undefined })).rejects.toBeInstanceOf(
            BadRequestException
        );
        await expect(
            svc.create(ACCT, { ...NEW_FORM, fields: [{ field: 'zz' }] })
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    describe.each(PLAN_IDS)('on %s', plan_id => {
        it("caps the forms per account at the plan's", async () => {
            const { svc, forms } = setup(plan_id);
            const cap = PLANS[plan_id].caps.forms;
            for (let i = 0; i < cap - 1; i++) {
                forms.push({ id: `f${i}`, account_id: ACCT });
            }
            await expect(svc.create(ACCT, NEW_FORM)).resolves.toBeTruthy();
            const err = await svc.create(ACCT, NEW_FORM).catch(e => e);
            expect(err).toBeInstanceOf(HttpException);
            expect(err.getStatus()).toBe(403);
            expect(err.getResponse()).toMatchObject({ code: 'plan_limit', limit: 'forms', cap });
        });
    });

    it('keeps each account to its own forms', async () => {
        const { svc } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        expect((await svc.list(OTHER)).forms).toEqual([]);
        await expect(svc.get(OTHER, form.id)).rejects.toBeInstanceOf(NotFoundException);
        await expect(svc.update(OTHER, form.id, { open: false })).rejects.toBeInstanceOf(
            NotFoundException
        );
        await expect(svc.remove(OTHER, form.id)).rejects.toBeInstanceOf(NotFoundException);
        await expect(svc.list(OTHER, 11)).rejects.toBeInstanceOf(ForbiddenException);
        const listed = await svc.list(ACCT, 11);
        expect(listed.forms.map(f => f.id)).toEqual([form.id]);
        expect(listed.columns.map(c => [c.field, c.type])).toEqual([
            ['a', 'string'],
            ['b', 'number']
        ]);
    });

    it('closes a form, and refuses moving it to another table', async () => {
        const { svc } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        expect((await svc.update(ACCT, form.id, { open: false })).open).toBe(false);
        await expect(svc.update(ACCT, form.id, { file_id: 12 })).rejects.toBeInstanceOf(
            BadRequestException
        );
    });
});

describe('FormService (public link)', () => {
    it('shows an open form’s questions', async () => {
        const { svc } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        const view = await svc.public_view(form.id);
        expect(view.title).toBe('Sign up');
        expect(view.fields.map(f => [f.key, f.type, f.required])).toEqual([
            ['a', 'string', true],
            ['b', 'number', false]
        ]);
    });

    it('stops working once the form is closed, deleted or its table is', async () => {
        const { svc, files } = setup();
        const closed: any = await svc.create(ACCT, NEW_FORM);
        await svc.update(ACCT, closed.id, { open: false });
        await expect(svc.public_view(closed.id)).rejects.toBeInstanceOf(GoneException);
        await expect(svc.public_view(closed.id)).rejects.toThrow(FORM_CLOSED);
        await expect(svc.submit(closed.id, { values: { a: 'x' } })).rejects.toBeInstanceOf(
            GoneException
        );

        const deleted: any = await svc.create(ACCT, NEW_FORM);
        await svc.remove(ACCT, deleted.id);
        await expect(svc.public_view(deleted.id)).rejects.toThrow(FORM_NOT_FOUND);

        const orphan: any = await svc.create(ACCT, NEW_FORM);
        files[11].deleted = true;
        await expect(svc.public_view(orphan.id)).rejects.toBeInstanceOf(NotFoundException);
        await expect(svc.public_view('form_nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('adds a checked submission as a row of the form’s table', async () => {
        const { svc, rows, forms } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        const res = await svc.submit(form.id, { values: { a: 'Ada', b: '36' } });
        expect(res).toEqual({ ok: true, thank_you: 'Thanks!', redirect_url: null });
        expect(rows).toEqual([
            { account_id: ACCT, file_id: 11, type: 'data_grid_row', data: [{ a: 'Ada', b: 36 }] }
        ]);
        expect(forms[0].submissions).toBe(1);
    });

    it('answers wrong answers with a 400 and their fields', async () => {
        const { svc, rows } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        try {
            await svc.submit(form.id, { values: { a: '', b: 'lots' } });
            throw new Error('did not throw');
        } catch (ex) {
            expect(ex).toBeInstanceOf(BadRequestException);
            expect((ex as BadRequestException).getResponse()).toMatchObject({
                errors: { a: 'This field is required', b: 'Enter a number' }
            });
        }
        expect(rows).toEqual([]);
    });

    it('answers a filled honeypot like a submission, but adds nothing', async () => {
        const { svc, rows, forms } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        const res = await svc.submit(form.id, { values: { a: 'x' }, [HONEYPOT_FIELD]: 'spam' });
        expect(res.ok).toBe(true);
        expect(rows).toEqual([]);
        expect(forms[0].submissions).toBe(0);
    });

    it('hides the owner’s plan limit or lock behind a generic 403', async () => {
        const { svc, web_file_svc } = setup();
        const form: any = await svc.create(ACCT, NEW_FORM);
        web_file_svc.batch_create_internal.mockRejectedValueOnce(
            new HttpException('Row count limit exceeded for current subscription', 403)
        );
        const p = svc.submit(form.id, { values: { a: 'x' } });
        await expect(p).rejects.toThrow(FORM_UNAVAILABLE);
        expect(await status_of(svc.submit(form.id, { values: { a: 'x' } }))).toBe(200);
        web_file_svc.batch_create_internal.mockRejectedValueOnce(new Error('db down'));
        await expect(svc.submit(form.id, { values: { a: 'x' } })).rejects.toThrow('db down');
    });
});
