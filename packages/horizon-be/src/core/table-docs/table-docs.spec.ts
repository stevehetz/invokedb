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
import {
    QueryColumn,
    QueryColumnType,
    parse_count_query,
    parse_row_query
} from '../web-file/row-query';
import { normalize_link_value } from '../web-file/link';

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
        joined: '2020-01-02T00:00:00.000Z'
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
    it('lists the seven endpoints with their methods and URLs', () => {
        const docs = build_table_docs(input());
        expect(docs.base_url).toBe('https://api.example.com/api/v1');
        expect(docs.endpoints.map(e => [e.id, e.method, e.read_only])).toEqual([
            ['get', 'GET', true],
            ['search', 'POST', true],
            ['query', 'POST', true],
            ['count', 'POST', true],
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
                    joined: '2020-01-02T00:00:00.000Z'
                }
            ]
        });
        expect(endpoint(docs, 'update').body).toEqual([
            { _id: ROW_ID_PLACEHOLDER, 'Full Name': 'Alice' }
        ]);
        expect(endpoint(docs, 'delete').body).toEqual([ROW_ID_PLACEHOLDER]);
    });

    it('builds the query and count examples (#141) in a form parse_row_query accepts', () => {
        const docs = build_table_docs(input());
        const filters = [{ column: 'Full Name', op: 'contains', value: 'Alice' }];
        expect(endpoint(docs, 'query').body).toEqual({
            filters,
            sort: [{ column: 'age', dir: 'desc' }],
            fields: ['Full Name', 'age', 'joined'],
            limit: 10
        });
        expect(endpoint(docs, 'query').url).toBe(
            'https://api.example.com/api/v1/query?table=people'
        );
        expect(endpoint(docs, 'query').response.body).toEqual({
            data: [
                { _id: 'abc123', 'Full Name': 'Alice', age: 30, joined: '2020-01-02T00:00:00.000Z' }
            ],
            next_cursor: null
        });
        expect(endpoint(docs, 'count').body).toEqual({ filters });
        expect(endpoint(docs, 'query').snippets.client).toContain('table.query({');
        expect(endpoint(docs, 'count').snippets.client).toContain('table.count({');
        const columns: QueryColumn[] = docs.columns.map((c, i) => ({
            name: c.name,
            field: String.fromCharCode(97 + i),
            type: c.type as QueryColumnType
        }));
        expect(() => parse_row_query(endpoint(docs, 'query').body, columns)).not.toThrow();
        expect(() => parse_count_query(endpoint(docs, 'count').body, columns)).not.toThrow();
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
            '/query',
            '/count',
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
        // No link columns, so no expand
        const params = op => op.parameters.map(p => p.name);
        expect(params(spec.paths['/get'].get)).not.toContain('expand');
    });
});

// Link columns (#147, #176): an array of row ids of another table, or the rows with expand
describe('a table with a link column', () => {
    const contact_id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const link_input = (sample = true) => ({
        table: 'tasks',
        base_url: 'https://api.example.com/api/v1',
        columns: [
            { name: 'Contact', type: 'link', link_table: 'contacts' },
            { name: 'Task', type: 'string' },
            { name: 'due', type: 'date' }
        ],
        sample_row: sample
            ? { _id: 'abc123', Contact: [contact_id], Task: 'Call', due: '2020-01-02' }
            : undefined
    });

    it('gives the column the link type and its table', () => {
        expect(doc_columns(link_input().columns)).toEqual([
            { name: 'Contact', type: 'link', link_table: 'contacts' },
            { name: 'Task', type: 'string' },
            { name: 'due', type: 'date' }
        ]);
        expect(column_type('link')).toBe('link');
        expect(doc_columns([{ name: 'x', type: 'string', link_table: 't' }])).toEqual([
            { name: 'x', type: 'string' }
        ]);
    });

    it('uses arrays of row ids in the examples', () => {
        const docs = build_table_docs(link_input());
        expect(endpoint(docs, 'get').response.body.data[0].Contact).toEqual([contact_id]);
        expect(endpoint(docs, 'create').body).toEqual([
            { Contact: [contact_id], Task: 'Call', due: '2024-01-15' }
        ]);
        // The examples filter, sort and update on other columns
        expect(endpoint(docs, 'search').body).toEqual({
            Task: { type: 'contains', value: 'Call', case: 'insensitive' }
        });
        expect(endpoint(docs, 'query').body.sort).toEqual([{ column: 'due', dir: 'desc' }]);
        expect(endpoint(docs, 'update').body).toEqual([{ _id: ROW_ID_PLACEHOLDER, Task: 'Call' }]);
        expect(endpoint(docs, 'create').description).toContain('array of _ids');
        // What the API accepts for the cell
        expect(normalize_link_value(endpoint(docs, 'create').body[0].Contact)).toEqual([
            contact_id
        ]);
    });

    it('sends null rather than a made-up id when the sample row has none', () => {
        const docs = build_table_docs(link_input(false));
        expect(endpoint(docs, 'create').body[0].Contact).toBeNull();
        const out = endpoint(docs, 'get').response.body.data[0].Contact;
        expect(Array.isArray(out) && out.length).toBe(1);
        expect(out[0]).toMatch(/^[0-9a-f]{24}$/);
    });

    it('lists expand on get, search and query', () => {
        const docs = build_table_docs(link_input());
        const has_expand = id => endpoint(docs, id).params.some(p => p.name === 'expand');
        expect(['get', 'search', 'query'].filter(has_expand)).toEqual(['get', 'search', 'query']);
        expect(['count', 'create', 'update', 'delete'].some(has_expand)).toBe(false);
        expect(endpoint(docs, 'get').params.find(p => p.name === 'expand').description).toContain(
            'Contact'
        );
        expect(endpoint(build_table_docs(input()), 'get').params.map(p => p.name)).not.toContain(
            'expand'
        );
    });

    it('describes the column and expand in the OpenAPI spec', () => {
        const spec: any = build_openapi(link_input());
        const contact = spec.components.schemas.Row.properties.Contact;
        expect(contact).toEqual(
            expect.objectContaining({ type: 'array', nullable: true, maxItems: 50 })
        );
        expect(contact.items.oneOf[0]).toEqual({ type: 'string', pattern: '^[0-9a-fA-F]{24}$' });
        expect(contact.items.oneOf[1].required).toEqual(['_id']);
        expect(contact.description).toContain('"contacts"');
        expect(contact.description).toContain('expand=Contact');
        const expand_of = op => op.parameters.find(p => p.name === 'expand');
        expect(expand_of(spec.paths['/get'].get)).toEqual(
            expect.objectContaining({ in: 'query', schema: { type: 'string', example: 'Contact' } })
        );
        expect(expand_of(spec.paths['/search'].post)).toBeDefined();
        expect(expand_of(spec.paths['/query'].post)).toBeDefined();
        expect(expand_of(spec.paths['/count'].post)).toBeUndefined();
        expect(spec.paths['/get'].get.responses['200'].content['application/json'].example).toEqual(
            {
                count: 1,
                data: [{ _id: 'abc123', Contact: [contact_id], Task: 'Call', due: '2020-01-02' }]
            }
        );
    });
});
