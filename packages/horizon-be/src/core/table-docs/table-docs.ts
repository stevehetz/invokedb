// Per-table API docs (#139): the /api/v1 endpoints for one table, with example requests and
// responses built from the table's own columns, ready-to-copy snippets (curl, fetch, the
// `invokedb` client, Python) and an OpenAPI 3 spec. Pure functions, so they're unit-tested
// (table-docs.spec.ts); the smoke test (scripts/api-smoke.mjs) runs the curl, fetch and Python
// snippets against a real backend.
import {
    DEFAULT_QUERY_LIMIT,
    MAX_FILTERS,
    MAX_QUERY_LIMIT,
    MAX_SORT,
    OPERATORS
} from '../web-file/row-query';
import { LINK_TYPE, MAX_LINKS_PER_CELL, is_row_id } from '../web-file/link';

// A link column (#147) holds an array of row ids of another table (or null), or the linked
// rows themselves when the request names it in `expand`
export type ColumnType = 'string' | 'number' | 'date' | 'link';

export interface DocColumn {
    name: string;
    type: ColumnType;
    // A link column's table, by name (when it's known)
    link_table?: string;
}

export interface TableDocsInput {
    table: string;
    // The /api/v1 base, e.g. https://api.invokedb.com/api/v1
    base_url: string;
    columns: Array<{ name: string; type?: string; link_table?: string }>;
    // One row of the table, by column name, so the examples use real values
    sample_row?: Record<string, unknown>;
    // The account's plan's query page (#183); the largest of any plan when not given
    max_query_limit?: number;
}

export type Language = 'curl' | 'fetch' | 'client' | 'python';

export interface EndpointDoc {
    id: 'get' | 'search' | 'query' | 'count' | 'create' | 'update' | 'delete';
    title: string;
    method: 'GET' | 'POST' | 'PUT';
    // Full URL, with the example query string
    url: string;
    description: string;
    // Doesn't change the table (safe for "Try it" with writes turned off)
    read_only: boolean;
    params: Array<{ name: string; in: 'query' | 'body'; description: string }>;
    body?: unknown;
    response: { status: number; body: unknown };
    snippets: Record<Language, string>;
}

export interface TableDocs {
    table: string;
    base_url: string;
    columns: DocColumn[];
    // Snippets read the key from this environment variable
    api_key_env: string;
    // Update and delete snippets use this in place of a row's _id
    row_id_placeholder: string;
    openapi_url: string;
    endpoints: EndpointDoc[];
}

export const API_KEY_ENV = 'INVOKEDB_API_KEY';
export const ROW_ID_PLACEHOLDER = 'ROW_ID';
export const MAX_WRITE_ROWS = 100;
const EXAMPLE_ID = '5f38f1a22a3a9d1db22bae3d';
const DEFAULT_DATE = '2024-01-15';
// The API returns dates like this (web-file.manager format_date_field)
const DEFAULT_DATE_OUT = '2024-01-15 12:00:00 AM';
// A row id of a linked table, for responses when the sample row has none
const EXAMPLE_LINK_ID = '5f38f1a22a3a9d1db22bae3e';

export function column_type(type: unknown): ColumnType {
    return type === 'number' || type === 'date' || type === LINK_TYPE ? type : 'string';
}

export function doc_columns(columns: TableDocsInput['columns']): DocColumn[] {
    return (columns || [])
        .filter(c => c && typeof c.name === 'string' && c.name.length > 0)
        .map(c => {
            const col: DocColumn = { name: c.name, type: column_type(c.type) };
            if (col.type === 'link' && typeof c.link_table === 'string' && c.link_table) {
                col.link_table = c.link_table;
            }
            return col;
        });
}

const is_link = (c: DocColumn) => c.type === 'link';

// The row ids in the sample row's link cell, if it has any
function sample_link_ids(v: unknown): string[] | null {
    if (!Array.isArray(v)) return null;
    const ids = v.filter(is_row_id).slice(0, 3);
    return ids.length > 0 ? ids : null;
}

function trim_slashes(url: string) {
    let end = url.length;
    while (end > 0 && url[end - 1] === '/') end--;
    return url.slice(0, end);
}

// A value for a column in a request body: the sample row's when it fits the type
function request_value(col: DocColumn, sample: Record<string, unknown>) {
    const v = sample[col.name];
    // Only real ids (or null): a made-up id is refused, and the create snippet has to run
    if (is_link(col)) return sample_link_ids(v);
    if (col.type === 'number') return typeof v === 'number' && isFinite(v) ? v : 42;
    if (col.type === 'date') return DEFAULT_DATE;
    return typeof v === 'string' && v.length > 0 && v.length <= 60 ? v : 'example text';
}

// A value for a column in a response: what the API would send back
function response_value(col: DocColumn, sample: Record<string, unknown>) {
    const v = sample[col.name];
    if (col.type === 'date') return typeof v === 'string' && v ? v : DEFAULT_DATE_OUT;
    if (is_link(col)) return sample_link_ids(v) || [EXAMPLE_LINK_ID];
    return request_value(col, sample);
}

function example_row(columns: DocColumn[], sample: Record<string, unknown>) {
    const row: Record<string, unknown> = {};
    columns.forEach(c => (row[c.name] = request_value(c, sample)));
    return row;
}

function response_row(columns: DocColumn[], sample: Record<string, unknown>) {
    const row: Record<string, unknown> = {
        _id: typeof sample._id === 'string' ? sample._id : EXAMPLE_ID
    };
    columns.forEach(c => (row[c.name] = response_value(c, sample)));
    return row;
}

// The search example filters on one column: a text column with a value if there is one
function search_column(columns: DocColumn[], sample: Record<string, unknown>) {
    return (
        columns.find(c => c.type === 'string' && typeof sample[c.name] === 'string') ||
        columns.find(c => c.type === 'string') ||
        columns.find(c => !is_link(c))
    );
}

function search_filter(col: DocColumn | undefined, sample: Record<string, unknown>) {
    if (!col) return {};
    if (col.type === 'number') {
        return { [col.name]: { type: 'greaterThanOrEqual', value: request_value(col, sample) } };
    }
    if (col.type === 'date') {
        return { [col.name]: { type: 'greaterThanOrEqual', value: '2020-01-01' } };
    }
    return {
        [col.name]: { type: 'contains', value: request_value(col, sample), case: 'insensitive' }
    };
}

// The /query and /count example (#141): one filter like the search example's, in the
// { column, op, value } form
function query_filters(col: DocColumn | undefined, sample: Record<string, unknown>) {
    if (!col) return [];
    if (col.type === 'number') {
        return [{ column: col.name, op: 'gte', value: request_value(col, sample) }];
    }
    if (col.type === 'date') return [{ column: col.name, op: 'gte', value: '2020-01-01' }];
    return [{ column: col.name, op: 'contains', value: request_value(col, sample) }];
}

// Sorts by a number or date column, largest or newest first, if there is one
function query_sort(columns: DocColumn[]) {
    const col =
        columns.find(c => c.type === 'number' || c.type === 'date') ||
        columns.find(c => !is_link(c));
    if (!col) return [];
    return [{ column: col.name, dir: col.type === 'string' ? 'asc' : 'desc' }];
}

// The same filter in the client's shorthand ($ctn, $gte, ...)
const CLIENT_OPS: Record<string, string> = {
    contains: '$ctn',
    equals: '$eq',
    greaterThan: '$gt',
    greaterThanOrEqual: '$gte',
    lessThan: '$lt',
    lessThanOrEqual: '$lte'
};

function client_filter(filter: Record<string, any>) {
    const out: Record<string, unknown> = {};
    Object.keys(filter).forEach(name => {
        const f = filter[name];
        out[name] = { [CLIENT_OPS[f.type] || '$eq']: f.value };
    });
    return out;
}

// --- Literals for each language ---

// A POSIX shell single-quoted string
export function sh_quote(s: string) {
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

function indent_rest(text: string, pad: string) {
    return text.split('\n').join(`\n${pad}`);
}

// JSON is a valid JavaScript expression
export function js_literal(value: unknown, pad = '') {
    return indent_rest(JSON.stringify(value, null, 4), pad);
}

// A Python expression for a JSON value (JSON strings and numbers are valid Python)
export function py_literal(value: unknown, pad = ''): string {
    const inner = pad + '    ';
    if (value === null || value === undefined) return 'None';
    if (value === true) return 'True';
    if (value === false) return 'False';
    if (typeof value === 'number') return isFinite(value) ? String(value) : 'None';
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        const items = value.map(v => `${inner}${py_literal(v, inner)},`);
        return `[\n${items.join('\n')}\n${pad}]`;
    }
    const keys = Object.keys(value as object);
    if (keys.length === 0) return '{}';
    const items = keys.map(
        k => `${inner}${JSON.stringify(k)}: ${py_literal((value as any)[k], inner)},`
    );
    return `{\n${items.join('\n')}\n${pad}}`;
}

interface SnippetRequest {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    body?: unknown;
}

export function curl_snippet({ method, url, body }: SnippetRequest) {
    const lines = [
        method === 'GET' ? `curl ${sh_quote(url)}` : `curl -X ${method} ${sh_quote(url)}`
    ];
    lines.push(`  -H "Authorization: Bearer $${API_KEY_ENV}"`);
    if (body !== undefined) {
        lines.push(`  -H 'Content-Type: application/json'`);
        lines.push(`  -d ${sh_quote(JSON.stringify(body, null, 2))}`);
    }
    return lines.join(' \\\n') + '\n';
}

// An ES module (top-level await) for Node 18+
export function fetch_snippet({ method, url, body }: SnippetRequest) {
    const headers = [`        Authorization: \`Bearer \${process.env.${API_KEY_ENV}}\``];
    if (body !== undefined) headers.push(`        'Content-Type': 'application/json'`);
    const opts = [`    method: '${method}'`, `    headers: {\n${headers.join(',\n')}\n    }`];
    if (body !== undefined) opts.push(`    body: JSON.stringify(${js_literal(body, '    ')})`);
    return (
        `const res = await fetch(${JSON.stringify(url)}, {\n${opts.join(',\n')}\n});\n` +
        `console.log(res.status, await res.text());\n`
    );
}

// Standard library only (urllib), so it runs without installing anything
export function python_snippet({ method, url, body }: SnippetRequest) {
    const headers = [`        "Authorization": "Bearer " + os.environ["${API_KEY_ENV}"],`];
    if (body !== undefined) headers.push(`        "Content-Type": "application/json",`);
    const args = [
        `    ${JSON.stringify(url)},`,
        `    method="${method}",`,
        `    headers={\n${headers.join('\n')}\n    },`
    ];
    if (body !== undefined) args.push(`    data=json.dumps(${py_literal(body, '    ')}).encode(),`);
    return (
        `import json\nimport os\nimport urllib.request\n\n` +
        `req = urllib.request.Request(\n${args.join('\n')}\n)\n` +
        `with urllib.request.urlopen(req) as res:\n` +
        `    print(res.status, res.read().decode())\n`
    );
}

function client_snippet(base_url: string, table: string, call: string) {
    return (
        `import { InvokeDBClient } from 'invokedb';\n\n` +
        `const db = new InvokeDBClient({\n` +
        `    apiKey: process.env.${API_KEY_ENV},\n` +
        `    baseUrl: ${JSON.stringify(base_url)}\n` +
        `});\n` +
        `const table = db.table(${JSON.stringify(table)});\n\n` +
        `const res = await ${call};\n` +
        `console.log(res);\n`
    );
}

function snippets(req: SnippetRequest, base_url: string, table: string, client_call: string) {
    return {
        curl: curl_snippet(req),
        fetch: fetch_snippet(req),
        client: client_snippet(base_url, table, client_call),
        python: python_snippet(req)
    };
}

const PAGE_PARAMS: EndpointDoc['params'] = [
    { name: 'table', in: 'query', description: 'The table name' },
    { name: 'skip', in: 'query', description: 'Rows to skip (for paging)' },
    { name: 'limit', in: 'query', description: 'Rows to return, at most 1000' },
    { name: 'sort_by', in: 'query', description: 'Optional: a column name to sort by' },
    { name: 'sort_dir', in: 'query', description: 'Optional: asc or desc (with sort_by)' }
];
const TABLE_PARAM: EndpointDoc['params'] = [
    { name: 'table', in: 'query', description: 'The table name' }
];

// /get, /search and /query take `expand` when the table has link columns (#147)
function expand_params(links: DocColumn[]): EndpointDoc['params'] {
    if (links.length === 0) return [];
    return [
        {
            name: 'expand',
            in: 'query',
            description:
                'Optional: link columns, comma-separated (' +
                links.map(c => c.name).join(', ') +
                '), to return as the linked rows instead of their _ids'
        }
    ];
}

export function build_table_docs(input: TableDocsInput): TableDocs {
    const table = input.table;
    const base_url = trim_slashes(input.base_url);
    const columns = doc_columns(input.columns);
    const sample = input.sample_row || {};
    const t = encodeURIComponent(table);
    const url = (action: string, query = '') => `${base_url}/${action}?table=${t}${query}`;
    const page = '&skip=0&limit=10';
    const expand = expand_params(columns.filter(is_link));

    const row = example_row(columns, sample);
    const out_row = response_row(columns, sample);
    const filter = search_filter(search_column(columns, sample), sample);
    const filters = query_filters(search_column(columns, sample), sample);
    const fields = columns.slice(0, 3).map(c => c.name);
    const query_body: Record<string, unknown> = {
        filters,
        sort: query_sort(columns),
        fields,
        limit: 10
    };
    const query_row: Record<string, unknown> = { _id: out_row._id };
    fields.forEach(name => (query_row[name] = out_row[name]));
    const update_col = columns.find(c => !is_link(c)) || columns[0];
    const update_row: Record<string, unknown> = { _id: ROW_ID_PLACEHOLDER };
    if (update_col) update_row[update_col.name] = request_value(update_col, sample);

    const get_req: SnippetRequest = { method: 'GET', url: url('get', page) };
    const search_req: SnippetRequest = { method: 'POST', url: url('search', page), body: filter };
    const query_req: SnippetRequest = { method: 'POST', url: url('query'), body: query_body };
    const count_req: SnippetRequest = { method: 'POST', url: url('count'), body: { filters } };
    const create_req: SnippetRequest = { method: 'POST', url: url('create'), body: [row] };
    const update_req: SnippetRequest = { method: 'PUT', url: url('update'), body: [update_row] };
    const delete_req: SnippetRequest = {
        method: 'POST',
        url: url('delete'),
        body: [ROW_ID_PLACEHOLDER]
    };

    const endpoints: EndpointDoc[] = [
        {
            id: 'get',
            title: 'Get rows',
            ...get_req,
            description: 'Returns a page of rows and the total row count.',
            read_only: true,
            params: [...PAGE_PARAMS, ...expand],
            response: { status: 200, body: { count: 1, data: [out_row] } },
            snippets: snippets(get_req, base_url, table, 'table.find().skip(0).limit(10).exec()')
        },
        {
            id: 'search',
            title: 'Search rows',
            ...search_req,
            description:
                'Returns the rows that match a filter. Each key is a column name; text columns ' +
                'take equals or contains, number and date columns take equals, lessThan, ' +
                'lessThanOrEqual, greaterThan and greaterThanOrEqual. Use an array for several ' +
                'conditions on one column and $or for any of several columns.',
            read_only: true,
            params: [
                ...PAGE_PARAMS,
                ...expand,
                { name: 'body', in: 'body', description: 'The filter, by column name' }
            ],
            response: { status: 201, body: { count: 1, data: [out_row] } },
            snippets: snippets(
                search_req,
                base_url,
                table,
                `table.find(${js_literal(client_filter(filter))}).skip(0).limit(10).exec()`
            )
        },
        {
            id: 'query',
            title: 'Query rows',
            ...query_req,
            description:
                'Returns rows that match every filter (or any, with "match": "any"), sorted by ' +
                'one or more columns, with only the columns in fields. Operators: eq, ne, gt, ' +
                'gte, lt, lte, in (an array), contains (text, case-insensitive unless "case": ' +
                '"sensitive") and empty (true or false). eq on text is exact and case-sensitive. ' +
                `limit is 1 to ${input.max_query_limit ?? MAX_QUERY_LIMIT} ` +
                `(default ${DEFAULT_QUERY_LIMIT}). For the next ` +
                'page, send the same body with "cursor" set to next_cursor; it is null on the ' +
                'last page. Pages stay in order when rows are added. "explain": true returns ' +
                'whether the query uses a column index instead of rows.',
            read_only: true,
            params: [
                ...TABLE_PARAM,
                ...expand,
                {
                    name: 'body',
                    in: 'body',
                    description:
                        'filters ([{ column, op, value }]), match (all or any), sort ' +
                        '(["column", "-column"] or [{ column, dir }]), fields, limit, cursor, explain'
                }
            ],
            response: { status: 200, body: { data: [query_row], next_cursor: null } },
            snippets: snippets(query_req, base_url, table, `table.query(${js_literal(query_body)})`)
        },
        {
            id: 'count',
            title: 'Count rows',
            ...count_req,
            description:
                'Returns the number of rows that match the filters (the same filters and match ' +
                'as Query rows). Send {} to count every row.',
            read_only: true,
            params: [
                ...TABLE_PARAM,
                {
                    name: 'body',
                    in: 'body',
                    description: 'filters ([{ column, op, value }]) and match (all or any)'
                }
            ],
            response: { status: 200, body: { count: 1 } },
            snippets: snippets(
                count_req,
                base_url,
                table,
                `table.count(${js_literal({ filters })})`
            )
        },
        {
            id: 'create',
            title: 'Create rows',
            ...create_req,
            description:
                `Adds rows (an array of up to ${MAX_WRITE_ROWS}, by column name). Leave out any column to leave it empty.` +
                (columns.some(is_link)
                    ? ' A link column takes an array of _ids of rows of its table, or null.'
                    : ''),
            read_only: false,
            params: [
                ...TABLE_PARAM,
                { name: 'body', in: 'body', description: 'An array of rows, without _id' }
            ],
            response: { status: 201, body: '' },
            snippets: snippets(create_req, base_url, table, `table.insert(${js_literal([row])})`)
        },
        {
            id: 'update',
            title: 'Update rows',
            ...update_req,
            description: `Changes rows by _id (an array of up to ${MAX_WRITE_ROWS}). Only the columns you send change. Returns the number of rows updated.`,
            read_only: false,
            params: [
                ...TABLE_PARAM,
                {
                    name: 'body',
                    in: 'body',
                    description: `An array of rows, each with its _id (replace ${ROW_ID_PLACEHOLDER})`
                }
            ],
            response: { status: 200, body: 1 },
            snippets: snippets(
                update_req,
                base_url,
                table,
                `table.update(${js_literal([update_row])})`
            )
        },
        {
            id: 'delete',
            title: 'Delete rows',
            ...delete_req,
            description: 'Deletes rows by _id. Returns the number of rows deleted.',
            read_only: false,
            params: [
                ...TABLE_PARAM,
                {
                    name: 'body',
                    in: 'body',
                    description: `An array of _id strings (replace ${ROW_ID_PLACEHOLDER})`
                }
            ],
            response: { status: 201, body: 1 },
            snippets: snippets(
                delete_req,
                base_url,
                table,
                `table.delete(${JSON.stringify(ROW_ID_PLACEHOLDER)})`
            )
        }
    ];

    return {
        table,
        base_url,
        columns,
        api_key_env: API_KEY_ENV,
        row_id_placeholder: ROW_ID_PLACEHOLDER,
        openapi_url: url('openapi'),
        endpoints
    };
}

// --- OpenAPI 3 ---

function column_schema(col: DocColumn) {
    if (col.type === 'number') return { type: 'number' };
    if (col.type === 'date') {
        return {
            type: 'string',
            description: `A date. Send e.g. ${DEFAULT_DATE} or ISO 8601; returned like ${DEFAULT_DATE_OUT}.`
        };
    }
    if (is_link(col)) {
        const table = col.link_table ? `"${col.link_table}"` : 'another table';
        return {
            type: 'array',
            nullable: true,
            maxItems: MAX_LINKS_PER_CELL,
            description:
                `A link to rows of ${table}: an array of their _ids, or null. With ` +
                `expand=${col.name} the API returns the linked rows instead (_id and their ` +
                'columns); those can be sent back as they are.',
            items: {
                oneOf: [
                    { type: 'string', pattern: '^[0-9a-fA-F]{24}$' },
                    {
                        type: 'object',
                        required: ['_id'],
                        properties: { _id: { type: 'string' } },
                        additionalProperties: true
                    }
                ]
            }
        };
    }
    return { type: 'string' };
}

export function build_openapi(input: TableDocsInput) {
    const docs = build_table_docs(input);
    const { table, columns } = docs;
    const properties: Record<string, unknown> = {};
    columns.forEach(c => (properties[c.name] = column_schema(c)));
    const by_id = Object.fromEntries(docs.endpoints.map(e => [e.id, e]));
    const column_names = columns.map(c => c.name);

    const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
    const json = (schema: unknown, example?: unknown) => ({
        'application/json': example === undefined ? { schema } : { schema, example }
    });
    const table_param = {
        name: 'table',
        in: 'query',
        required: true,
        schema: { type: 'string', enum: [table] }
    };
    const page_params = [
        table_param,
        { name: 'skip', in: 'query', required: true, schema: { type: 'integer', minimum: 0 } },
        {
            name: 'limit',
            in: 'query',
            required: true,
            schema: { type: 'integer', minimum: 1, maximum: 1000 }
        },
        {
            name: 'sort_by',
            in: 'query',
            schema: { type: 'string', enum: columns.map(c => c.name) }
        },
        { name: 'sort_dir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'] } }
    ];
    // Link columns (#147): /get, /search and /query take `expand`
    const link_names = columns.filter(is_link).map(c => c.name);
    const expand_param = link_names.length
        ? [
              {
                  name: 'expand',
                  in: 'query',
                  description:
                      'Link columns, comma-separated, to return as the linked rows instead of ' +
                      `their _ids (${link_names.join(', ')})`,
                  schema: { type: 'string', example: link_names.join(',') }
              }
          ]
        : [];
    const errors = {
        '400': { description: 'Bad request (unknown table or column, bad filter or body)' },
        '401': { description: 'Missing or wrong API key' }
    };
    const row_list = (example: unknown) => ({
        description: 'The total count and a page of rows',
        content: json(ref('RowList'), example)
    });

    return {
        openapi: '3.0.3',
        info: {
            title: `InvokeDB table ${table}`,
            version: '1',
            description: `The InvokeDB API for the table "${table}".`
        },
        servers: [{ url: docs.base_url }],
        security: [{ api_key: [] }],
        paths: {
            '/get': {
                get: {
                    operationId: 'get_rows',
                    summary: by_id.get.title,
                    description: by_id.get.description,
                    parameters: [...page_params, ...expand_param],
                    responses: { '200': row_list(by_id.get.response.body), ...errors }
                }
            },
            '/search': {
                post: {
                    operationId: 'search_rows',
                    summary: by_id.search.title,
                    description: by_id.search.description,
                    parameters: [...page_params, ...expand_param],
                    requestBody: {
                        required: true,
                        content: json(ref('Filter'), by_id.search.body)
                    },
                    responses: { '201': row_list(by_id.search.response.body), ...errors }
                }
            },
            '/query': {
                post: {
                    operationId: 'query_rows',
                    summary: by_id.query.title,
                    description: by_id.query.description,
                    parameters: [table_param, ...expand_param],
                    requestBody: {
                        required: true,
                        content: json(ref('Query'), by_id.query.body)
                    },
                    responses: {
                        '200': {
                            description:
                                'A page of rows and the cursor for the next one (null on the last ' +
                                'page), or { explain } with "explain": true',
                            content: json(ref('QueryResult'), by_id.query.response.body)
                        },
                        ...errors
                    }
                }
            },
            '/count': {
                post: {
                    operationId: 'count_rows',
                    summary: by_id.count.title,
                    description: by_id.count.description,
                    parameters: [table_param],
                    requestBody: {
                        required: true,
                        content: json(
                            {
                                type: 'object',
                                properties: {
                                    filters: ref('QueryFilters'),
                                    match: { type: 'string', enum: ['all', 'any'] }
                                },
                                additionalProperties: false
                            },
                            by_id.count.body
                        )
                    },
                    responses: {
                        '200': {
                            description: 'The number of matching rows',
                            content: json(
                                { type: 'object', properties: { count: { type: 'integer' } } },
                                by_id.count.response.body
                            )
                        },
                        ...errors
                    }
                }
            },
            '/create': {
                post: {
                    operationId: 'create_rows',
                    summary: by_id.create.title,
                    description: by_id.create.description,
                    parameters: [table_param],
                    requestBody: {
                        required: true,
                        content: json(
                            {
                                type: 'array',
                                minItems: 1,
                                maxItems: MAX_WRITE_ROWS,
                                items: ref('Row')
                            },
                            by_id.create.body
                        )
                    },
                    responses: { '201': { description: 'Created' }, ...errors }
                }
            },
            '/update': {
                put: {
                    operationId: 'update_rows',
                    summary: by_id.update.title,
                    description: by_id.update.description,
                    parameters: [table_param],
                    requestBody: {
                        required: true,
                        content: json({
                            type: 'array',
                            minItems: 1,
                            maxItems: MAX_WRITE_ROWS,
                            items: ref('RowWithId')
                        })
                    },
                    responses: {
                        '200': {
                            description: 'The number of rows updated',
                            content: json({ type: 'integer' })
                        },
                        ...errors
                    }
                }
            },
            '/delete': {
                post: {
                    operationId: 'delete_rows',
                    summary: by_id.delete.title,
                    description: by_id.delete.description,
                    parameters: [table_param],
                    requestBody: {
                        required: true,
                        content: json({ type: 'array', minItems: 1, items: { type: 'string' } })
                    },
                    responses: {
                        '201': {
                            description: 'The number of rows deleted',
                            content: json({ type: 'integer' })
                        },
                        ...errors
                    }
                }
            }
        },
        components: {
            securitySchemes: {
                api_key: {
                    type: 'http',
                    scheme: 'bearer',
                    description: 'Your API key, from the Account page'
                }
            },
            schemas: {
                Row: { type: 'object', properties, additionalProperties: false },
                RowWithId: {
                    type: 'object',
                    required: ['_id'],
                    properties: { _id: { type: 'string' }, ...properties },
                    additionalProperties: false
                },
                RowList: {
                    type: 'object',
                    properties: {
                        count: { type: 'integer' },
                        data: { type: 'array', items: ref('RowWithId') }
                    }
                },
                ColumnFilter: {
                    type: 'object',
                    required: ['type', 'value'],
                    properties: {
                        type: {
                            type: 'string',
                            enum: [
                                'equals',
                                'contains',
                                'lessThan',
                                'lessThanOrEqual',
                                'greaterThan',
                                'greaterThanOrEqual'
                            ]
                        },
                        value: {},
                        case: { type: 'string', enum: ['sensitive', 'insensitive'] }
                    }
                },
                QueryFilters: {
                    type: 'array',
                    maxItems: MAX_FILTERS,
                    items: {
                        type: 'object',
                        required: ['column', 'op', 'value'],
                        properties: {
                            column: { type: 'string', enum: [...column_names, '_id'] },
                            op: { type: 'string', enum: OPERATORS },
                            value: {},
                            case: { type: 'string', enum: ['sensitive', 'insensitive'] }
                        },
                        additionalProperties: false
                    }
                },
                Query: {
                    type: 'object',
                    properties: {
                        filters: ref('QueryFilters'),
                        match: { type: 'string', enum: ['all', 'any'] },
                        sort: {
                            type: 'array',
                            maxItems: MAX_SORT,
                            items: {
                                oneOf: [
                                    {
                                        type: 'string',
                                        description: 'A column name, "-name" for descending'
                                    },
                                    {
                                        type: 'object',
                                        required: ['column'],
                                        properties: {
                                            column: {
                                                type: 'string',
                                                enum: [...column_names, '_id']
                                            },
                                            dir: { type: 'string', enum: ['asc', 'desc'] }
                                        },
                                        additionalProperties: false
                                    }
                                ]
                            }
                        },
                        fields: {
                            type: 'array',
                            minItems: 1,
                            items: { type: 'string', enum: column_names }
                        },
                        limit: {
                            type: 'integer',
                            minimum: 1,
                            maximum: input.max_query_limit ?? MAX_QUERY_LIMIT,
                            default: DEFAULT_QUERY_LIMIT
                        },
                        cursor: { type: 'string', nullable: true },
                        explain: { type: 'boolean' }
                    },
                    additionalProperties: false
                },
                QueryResult: {
                    type: 'object',
                    properties: {
                        data: { type: 'array', items: ref('RowWithId') },
                        next_cursor: { type: 'string', nullable: true }
                    }
                },
                Filter: {
                    type: 'object',
                    description:
                        'Keys are column names, each a filter or an array of filters. $or ' +
                        'takes an object like this one; $group takes a column name.',
                    properties: {
                        ...Object.fromEntries(
                            columns.map(c => [
                                c.name,
                                {
                                    oneOf: [
                                        ref('ColumnFilter'),
                                        { type: 'array', items: ref('ColumnFilter') }
                                    ]
                                }
                            ])
                        ),
                        $or: { type: 'object' },
                        $group: { type: 'string', enum: columns.map(c => c.name) }
                    }
                }
            }
        }
    };
}
