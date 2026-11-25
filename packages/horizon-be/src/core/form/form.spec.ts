import {
    DEFAULT_SUBMIT_LABEL,
    DEFAULT_THANK_YOU,
    FORM_LIMITS,
    FormColumn,
    FormError,
    FormSettings,
    HONEYPOT_FIELD,
    form_columns,
    is_form_id,
    new_form_id,
    parse_fields,
    parse_form_settings,
    parse_redirect_url,
    parse_submission,
    public_form
} from './form';

const COLUMNS: FormColumn[] = [
    { field: 'a', name: 'name', type: 'string' },
    { field: 'b', name: 'age', type: 'number' },
    { field: 'c', name: 'joined', type: 'date' }
];

const settings = (over: Partial<FormSettings> = {}): FormSettings => ({
    title: 'Sign up',
    description: '',
    fields: [
        { field: 'a', label: '', required: true, help: '' },
        { field: 'b', label: 'Your age', required: false, help: 'In years' },
        { field: 'c', label: '', required: false, help: '' }
    ],
    submit_label: DEFAULT_SUBMIT_LABEL,
    thank_you: DEFAULT_THANK_YOU,
    redirect_url: null,
    open: true,
    ...over
});

const error_of = (fn: () => unknown) => {
    try {
        fn();
    } catch (ex) {
        return ex;
    }
    throw new Error('did not throw');
};

describe('form ids', () => {
    it('makes random ids that is_form_id accepts', () => {
        const a = new_form_id();
        expect(is_form_id(a)).toBe(true);
        expect(a).not.toBe(new_form_id());
    });

    it('refuses anything else', () => {
        for (const id of ['', 'form_', 'form_xyz', 'wh_' + 'a'.repeat(24), 1, null, {}]) {
            expect(is_form_id(id)).toBe(false);
        }
        expect(is_form_id('form_' + 'A'.repeat(24))).toBe(false);
    });
});

describe('form_columns', () => {
    it('keeps the live columns in grid order, with their types', () => {
        const cols = form_columns([
            { field: 'b', headerName: 'age', col_type: 'number', order: 2 },
            { field: 'x', headerName: '', deleted: true, order: 0 },
            { field: 'a', headerName: 'name', order: 1 },
            { field: 'c', headerName: 'joined', col_type: 'date', order: 3 },
            { field: 'd', headerName: 'odd', col_type: 'weird', order: 4 }
        ]);
        expect(cols).toEqual([...COLUMNS, { field: 'd', name: 'odd', type: 'string' }]);
    });

    it('copes with a missing list', () => {
        expect(form_columns(undefined)).toEqual([]);
    });
});

describe('parse_redirect_url', () => {
    it('takes http and https URLs, and nothing as none', () => {
        expect(parse_redirect_url('https://example.com/thanks')).toBe('https://example.com/thanks');
        expect(parse_redirect_url(' http://example.com ')).toBe('http://example.com/');
        expect(parse_redirect_url('')).toBeNull();
        expect(parse_redirect_url(null)).toBeNull();
        expect(parse_redirect_url(undefined)).toBeNull();
    });

    it('refuses other schemes, credentials and junk', () => {
        for (const bad of [
            'javascript:alert(1)',
            'data:text/html,hi',
            'ftp://example.com',
            'https://user:pw@example.com',
            'not a url',
            42,
            'https://example.com/' + 'a'.repeat(FORM_LIMITS.max_url_length)
        ]) {
            expect(() => parse_redirect_url(bad)).toThrow(FormError);
        }
    });
});

describe('parse_fields', () => {
    it('takes columns of the table, each once', () => {
        expect(parse_fields([{ field: 'a', required: true }, { field: 'c' }], COLUMNS)).toEqual([
            { field: 'a', label: '', required: true, help: '' },
            { field: 'c', label: '', required: false, help: '' }
        ]);
    });

    it('refuses an empty list, unknown or repeated columns and bad values', () => {
        expect(() => parse_fields([], COLUMNS)).toThrow('Pick at least one column');
        expect(() => parse_fields('a', COLUMNS)).toThrow(FormError);
        expect(() => parse_fields([{ field: 'z' }], COLUMNS)).toThrow('does not have');
        expect(() => parse_fields([{ field: 'a' }, { field: 'a' }], COLUMNS)).toThrow('twice');
        expect(() => parse_fields([{ field: 'a', required: 'yes' }], COLUMNS)).toThrow(
            'true or false'
        );
        expect(() => parse_fields([{ field: 'a', label: 5 }], COLUMNS)).toThrow('must be text');
        expect(() => parse_fields(['a'], COLUMNS)).toThrow(FormError);
    });
});

describe('parse_form_settings', () => {
    it('gives a new form its defaults', () => {
        expect(
            parse_form_settings(
                { file_id: 3, title: ' Sign up ', fields: [{ field: 'a' }] },
                COLUMNS
            )
        ).toEqual({
            title: 'Sign up',
            description: '',
            fields: [{ field: 'a', label: '', required: false, help: '' }],
            submit_label: DEFAULT_SUBMIT_LABEL,
            thank_you: DEFAULT_THANK_YOU,
            redirect_url: null,
            open: true
        });
    });

    it('needs a title and fields for a new form', () => {
        expect(() => parse_form_settings({ fields: [{ field: 'a' }] }, COLUMNS)).toThrow(
            'The title is required'
        );
        expect(() => parse_form_settings({ title: 'x' }, COLUMNS)).toThrow('Pick at least');
    });

    it('checks only the keys of a change', () => {
        expect(parse_form_settings({ open: false }, COLUMNS, settings())).toEqual({ open: false });
        expect(parse_form_settings({}, COLUMNS, settings())).toEqual({});
        expect(
            parse_form_settings({ redirect_url: 'https://e.com/x' }, COLUMNS, settings())
        ).toEqual({ redirect_url: 'https://e.com/x' });
        expect(() => parse_form_settings({ title: '' }, COLUMNS, settings())).toThrow('required');
        expect(() => parse_form_settings({ open: 'no' }, COLUMNS, settings())).toThrow(
            'true or false'
        );
    });

    it('refuses unknown keys and over-long text', () => {
        expect(() => parse_form_settings({ account_id: 9 }, COLUMNS, settings())).toThrow(
            'Unknown setting'
        );
        expect(() =>
            parse_form_settings(
                { title: 'x'.repeat(FORM_LIMITS.max_title_length + 1) },
                COLUMNS,
                settings()
            )
        ).toThrow('longer than');
    });
});

describe('public_form', () => {
    it('shows the questions with their types and nothing about the table', () => {
        const view = public_form({ ...settings(), id: 'form_1' }, COLUMNS);
        expect(view).toEqual({
            id: 'form_1',
            title: 'Sign up',
            description: '',
            submit_label: DEFAULT_SUBMIT_LABEL,
            honeypot: HONEYPOT_FIELD,
            fields: [
                { key: 'a', label: 'name', type: 'string', required: true, help: '' },
                { key: 'b', label: 'Your age', type: 'number', required: false, help: 'In years' },
                { key: 'c', label: 'joined', type: 'date', required: false, help: '' }
            ]
        });
        expect(Object.keys(view)).not.toContain('file_id');
        expect(Object.keys(view)).not.toContain('account_id');
    });

    it('leaves out a field whose column was deleted', () => {
        const view = public_form({ ...settings(), id: 'form_1' }, COLUMNS.slice(0, 1));
        expect(view.fields.map(f => f.key)).toEqual(['a']);
    });
});

describe('parse_submission', () => {
    it('turns answers into a row of the column types', () => {
        const res = parse_submission(
            { values: { a: ' Ada ', b: '1,234.5', c: '2020-01-02' }, [HONEYPOT_FIELD]: '' },
            settings(),
            COLUMNS
        );
        expect(res.spam).toBe(false);
        expect(res.row.a).toBe('Ada');
        expect(res.row.b).toBe(1234.5);
        expect(res.row.c).toEqual(new Date(Date.UTC(2020, 0, 2)));
    });

    it('stores an unanswered optional question as null', () => {
        const res = parse_submission({ values: { a: 'Ada', b: '' } }, settings(), COLUMNS);
        expect(res.row).toEqual({ a: 'Ada', b: null, c: null });
        expect(parse_submission({ values: { a: 'x', b: 7 } }, settings(), COLUMNS).row.b).toBe(7);
    });

    it('reports every wrong answer by field', () => {
        const ex = error_of(() =>
            parse_submission({ values: { a: '  ', b: '12abc', c: 'soon' } }, settings(), COLUMNS)
        ) as FormError;
        expect(ex).toBeInstanceOf(FormError);
        expect(ex.errors).toEqual({
            a: 'This field is required',
            b: 'Enter a number',
            c: 'Enter a date'
        });
    });

    it('refuses answers to columns the form does not ask about', () => {
        const form = settings({ fields: [{ field: 'a', label: '', required: false, help: '' }] });
        expect(() => parse_submission({ values: { a: 'x', b: '3' } }, form, COLUMNS)).toThrow(
            'does not have'
        );
        expect(() => parse_submission({ values: { _id: 'x' } }, form, COLUMNS)).toThrow(
            'does not have'
        );
    });

    it('refuses a missing or empty submission', () => {
        expect(() => parse_submission({}, settings(), COLUMNS)).toThrow('missing');
        expect(() => parse_submission({ values: [] }, settings(), COLUMNS)).toThrow('missing');
        const form = settings({ fields: [{ field: 'b', label: '', required: false, help: '' }] });
        expect(() => parse_submission({ values: {} }, form, COLUMNS)).toThrow('empty');
    });

    it('refuses objects and over-long text as answers', () => {
        const ex = error_of(() =>
            parse_submission(
                { values: { a: { $gt: '' }, b: 'NaN' } },
                settings({
                    fields: [
                        { field: 'a', label: '', required: false, help: '' },
                        { field: 'b', label: '', required: false, help: '' }
                    ]
                }),
                COLUMNS
            )
        ) as FormError;
        expect(ex.errors).toEqual({ a: 'Enter text', b: 'Enter a number' });
        const long = error_of(() =>
            parse_submission(
                { values: { a: 'x'.repeat(FORM_LIMITS.max_value_length + 1) } },
                settings(),
                COLUMNS
            )
        ) as FormError;
        expect(Object.keys(long.errors)).toEqual(['a']);
    });

    it('marks a filled honeypot as spam without checking the answers', () => {
        expect(parse_submission({ [HONEYPOT_FIELD]: 'http://spam' }, settings(), COLUMNS)).toEqual({
            spam: true,
            row: {}
        });
    });

    it('needs a question whose column is still there', () => {
        expect(() => parse_submission({ values: {} }, settings(), [])).toThrow('no questions');
    });
});
