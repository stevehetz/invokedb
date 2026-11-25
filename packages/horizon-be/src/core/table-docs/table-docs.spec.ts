import {
    API_KEY_ENV,
    ROW_ID_PLACEHOLDER,
    build_openapi,
    build_table_docs,
    column_type,
    curl_snippet,
    doc_columns,
    fetch_snippet,
    py_literal,
    python_snippet,
    sh_quote
} from './table-docs';

const input = () => ({
    table: 'people',
    base_url: 'https://api.example.com/api/v1/',
    columns: [
        { name: 'Full Name', type: 'string' },
        { name: 'age', type: 'number' },
        { name: 'joined', type: 'date' }
    ],
    sample_row: {
        _id: 'abc123',
        'Full Name': 'Alice',
        age: 30,
        joined: '2020-01-02 12:00:00 AM'
    }
});

const endpoint = (docs, id) => docs.endpoints.find(e => e.id === id);

describe('doc_columns', () => {
    it('defaults unknown types to string and drops unnamed columns', () => {
        expect(
            doc_columns([
                { name: 'a', type: 'number' },
                { name: 'b' },
                { name: 'c', type: 'weird' },
                { name: '', type: 'string' }
            ])
        ).toEqual([
            { name: 'a', type: 'number' },
            { name: 'b', type: 'string' },
            { name: 'c', type: 'string' }
        ]);
        expect(column_type('date')).toBe('date');
    });
});

describe('build_table_docs', () => {
    it('lists the five endpoints with their methods and URLs', () => {
        const docs = build_table_docs(input());
        expect(docs.base_url).toBe('https://api.example.com/api/v1');
        expect(docs.endpoints.map(e => [e.id, e.method, e.read_only])).toEqual([
            ['get', 'GET', true],
            ['search', 'POST', true],
            ['create', 'POST', false],
            ['update', 'PUT', false],
            ['delete', 'POST', false]
        ]);
        expect(endpoint(docs, 'get').url).toBe(
            'https://api.example.com/api/v1/get?table=people&skip=0&limit=10'
        );
        expect(endpoint(docs, 'create').url).toBe(
            'https://api.example.com/api/v1/create?table=people'
        );
        expect(docs.openapi_url).toBe('https://api.example.com/api/v1/openapi?table=people');
        expect(docs.api_key_env).toBe(API_KEY_ENV);
    });

    it('builds examples from the column names, types and the sample row', () => {
        const docs = build_table_docs(input());
        expect(endpoint(docs, 'create').body).toEqual([
            { 'Full Name': 'Alice', age: 30, joined: '2024-01-15' }
        ]);
        expect(endpoint(docs, 'search').body).toEqual({
            'Full Name': { type: 'contains', value: 'Alice', case: 'insensitive' }
        });
        expect(endpoint(docs, 'get').response.body).toEqual({
            count: 1,
            data: [
                {
                    _id: 'abc123',
                    'Full Name': 'Alice',
                    age: 30,
                    joined: '2020-01-02 12:00:00 AM'
                }
            ]
        });
        expect(endpoint(docs, 'update').body).toEqual([
            { _id: ROW_ID_PLACEHOLDER, 'Full Name': 'Alice' }
        ]);
        expect(endpoint(docs, 'delete').body).toEqual([ROW_ID_PLACEHOLDER]);
    });

    it('falls back to values by type without a sample row', () => {
        const docs = build_table_docs({ ...input(), sample_row: undefined });
        expect(endpoint(docs, 'create').body).toEqual([
            { 'Full Name': 'example text', age: 42, joined: '2024-01-15' }
        ]);
    });

    it('searches a number or date column with a range filter', () => {
        const numbers = build_table_docs({
            table: 't',
            base_url: 'http://x/api/v1',
            columns: [{ name: 'price', type: 'number' }]
        });
        expect(endpoint(numbers, 'search').body).toEqual({
            price: { type: 'greaterThanOrEqual', value: 42 }
        });
        const dates = build_table_docs({
            table: 't',
            base_url: 'http://x/api/v1',
            columns: [{ name: 'on', type: 'date' }]
        });
        expect(endpoint(dates, 'search').body).toEqual({
            on: { type: 'greaterThanOrEqual', value: '2020-01-01' }
        });
    });

    it('copes with a table with no columns', () => {
        const docs = build_table_docs({ table: 't', base_url: 'http://x/api/v1', columns: [] });
        expect(endpoint(docs, 'search').body).toEqual({});
        expect(endpoint(docs, 'create').body).toEqual([{}]);
        expect(endpoint(docs, 'update').body).toEqual([{ _id: ROW_ID_PLACEHOLDER }]);
    });

    it('gives every endpoint a snippet in each language that uses the env var key', () => {
        const docs = build_table_docs(input());
        docs.endpoints.forEach(e => {
            expect(Object.keys(e.snippets).sort()).toEqual(['client', 'curl', 'fetch', 'python']);
            expect(e.snippets.curl).toContain(`$${API_KEY_ENV}`);
            expect(e.snippets.fetch).toContain(`process.env.${API_KEY_ENV}`);
            expect(e.snippets.client).toContain(`process.env.${API_KEY_ENV}`);
            expect(e.snippets.python).toContain(`os.environ["${API_KEY_ENV}"]`);
            expect(e.snippets.curl).toContain(e.url);
        });
        const client = endpoint(docs, 'search').snippets.client;
        expect(client).toContain(`db.table("people")`);
        expect(client).toContain(`"$ctn": "Alice"`);
        expect(endpoint(docs, 'delete').snippets.client).toContain(
            `table.delete("${ROW_ID_PLACEHOLDER}")`
        );
    });
});

describe('snippets', () => {
    const body = [{ "it's": 'a "quote"', n: 1, ok: true, none: null }];

    it('single-quotes for the shell', () => {
        expect(sh_quote("it's")).toBe(`'it'\\''s'`);
        const curl = curl_snippet({ method: 'POST', url: 'http://x/create?table=t', body });
        expect(curl).toBe(
            `curl -X POST 'http://x/create?table=t' \\\n` +
                `  -H "Authorization: Bearer $INVOKEDB_API_KEY" \\\n` +
                `  -H 'Content-Type: application/json' \\\n` +
                `  -d ${sh_quote(JSON.stringify(body, null, 2))}\n`
        );
        expect(curl_snippet({ method: 'GET', url: 'http://x/get' })).toBe(
            `curl 'http://x/get' \\\n  -H "Authorization: Bearer $INVOKEDB_API_KEY"\n`
        );
    });

    it('writes a fetch snippet that is valid JavaScript and sends the body', async () => {
        const code = fetch_snippet({ method: 'PUT', url: 'http://x/update?table=t', body });
        const calls = [];
        const fake_fetch = async (url, opts) => {
            calls.push({ url, opts });
            return { status: 200, text: async () => '1' };
        };
        const logs = [];
        const fake_console = { log: (...a) => logs.push(a) };
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        await new AsyncFunction('fetch', 'process', 'console', code)(
            fake_fetch,
            { env: { [API_KEY_ENV]: 'k1' } },
            fake_console
        );
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://x/update?table=t');
        expect(calls[0].opts.method).toBe('PUT');
        expect(calls[0].opts.headers.Authorization).toBe('Bearer k1');
        expect(JSON.parse(calls[0].opts.body)).toEqual(body);
        expect(logs).toEqual([[200, '1']]);
    });

    it('writes Python literals', () => {
        expect(py_literal(null)).toBe('None');
        expect(py_literal(true)).toBe('True');
        expect(py_literal([])).toBe('[]');
        expect(py_literal({ a: [1, false], 'b"': 'x' })).toBe(
            '{\n    "a": [\n        1,\n        False,\n    ],\n    "b\\"": "x",\n}'
        );
        const py = python_snippet({ method: 'GET', url: 'http://x/get' });
        expect(py).toContain('method="GET"');
        expect(py).not.toContain('data=');
        expect(python_snippet({ method: 'POST', url: 'http://x', body })).toContain(
            'data=json.dumps('
        );
    });
});

describe('build_openapi', () => {
    it('describes the table and its columns', () => {
        const spec: any = build_openapi(input());
        expect(spec.openapi).toBe('3.0.3');
        expect(spec.servers).toEqual([{ url: 'https://api.example.com/api/v1' }]);
        expect(Object.keys(spec.paths)).toEqual([
            '/get',
            '/search',
            '/create',
            '/update',
            '/delete'
        ]);
        expect(spec.paths['/get'].get.parameters[0].schema.enum).toEqual(['people']);
        expect(spec.paths['/update'].put).toBeDefined();
        expect(spec.components.schemas.Row.properties).toEqual({
            'Full Name': { type: 'string' },
            age: { type: 'number' },
            joined: expect.objectContaining({ type: 'string' })
        });
        expect(spec.components.schemas.RowWithId.required).toEqual(['_id']);
        expect(spec.components.securitySchemes.api_key.scheme).toBe('bearer');
        // Every $ref points at a schema that exists
        const refs = JSON.stringify(spec).match(/#\/components\/schemas\/\w+/g) || [];
        refs.forEach(r => expect(spec.components.schemas[r.split('/').pop()]).toBeDefined());
    });
});
