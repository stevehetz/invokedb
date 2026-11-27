import {
    ASK_DEFAULT_ROWS,
    ASK_MAX_ROWS,
    ASK_MAX_TURNS,
    ASK_PROMPT_MAX_COLUMNS,
    ASK_PROMPT_MAX_TABLES,
    ASK_TOOL_NAME,
    AskError,
    MAX_QUESTION_LENGTH,
    PROPOSE_MAX_ROWS,
    api_call,
    ask_columns,
    ask_system_prompt,
    ask_tool,
    parse_ask_input,
    parse_propose_input,
    parse_question,
    prompt_tables,
    propose_tool,
    reply_text,
    resolve_ask_table,
    rows_for_model,
    tool_result_content
} from './ask';

const COL_DEFS = [
    { field: 'a', headerName: 'Name' },
    { field: 'b', headerName: 'Price', col_type: 'number' },
    { field: 'c', headerName: 'Added', col_type: 'date' },
    { field: 'd', headerName: 'Supplier', col_type: 'link', link_table_id: 5 },
    { field: 'e', headerName: '' }
];
const COLUMNS = ask_columns(COL_DEFS);

describe('ask_columns', () => {
    it('keeps named columns with their query types and leaves out link columns', () => {
        expect(COLUMNS).toEqual([
            { name: 'Name', header_name: 'Name', field: 'a', type: 'string' },
            { name: 'Price', header_name: 'Price', field: 'b', type: 'number' },
            { name: 'Added', header_name: 'Added', field: 'c', type: 'date' }
        ]);
    });
});

describe('parse_ask_input', () => {
    it('turns a run_query input into a checked query and count', () => {
        const ask = parse_ask_input(
            {
                filters: [{ column: 'Price', op: 'gt', value: 10 }],
                sort: [{ column: 'Price', dir: 'desc' }],
                fields: ['Name', 'Price'],
                limit: 5
            },
            COLUMNS
        );
        expect(ask.body.limit).toBe(5);
        expect(ask.query.filter).toEqual({ $and: [{ b: { $gt: 10 } }] });
        expect(ask.query.sort).toEqual([
            { field: 'b', dir: -1 },
            { field: '_id', dir: 1 }
        ]);
        expect(ask.query.fields.map(c => c.name)).toEqual(['Name', 'Price']);
        expect(ask.count_query.filter).toEqual({ $and: [{ b: { $gt: 10 } }] });
        expect(ask.query.explain).toBe(false);
    });

    it('defaults the limit and caps it', () => {
        expect(parse_ask_input({}, COLUMNS).query.limit).toBe(ASK_DEFAULT_ROWS);
        expect(parse_ask_input({ limit: ASK_MAX_ROWS }, COLUMNS).query.limit).toBe(ASK_MAX_ROWS);
        expect(() => parse_ask_input({ limit: ASK_MAX_ROWS + 1 }, COLUMNS)).toThrow(AskError);
        // A table from a description (#324) can read a whole preview's worth
        const big = { limit: PROPOSE_MAX_ROWS };
        expect(parse_ask_input(big, COLUMNS, PROPOSE_MAX_ROWS).query.limit).toBe(PROPOSE_MAX_ROWS);
        expect(() => parse_ask_input({ limit: 101 }, COLUMNS, PROPOSE_MAX_ROWS)).toThrow(AskError);
    });

    it('builds a run_query that must name a table when there is no current one (#324)', () => {
        const tool = ask_tool([], true, { no_current: true, max_rows: PROPOSE_MAX_ROWS });
        expect(tool.name).toBe(ASK_TOOL_NAME);
        expect((tool.input_schema as any).required).toEqual(['table']);
        expect(tool.input_schema.properties.limit.maximum).toBe(PROPOSE_MAX_ROWS);
        expect(tool.description).toContain(`first ${PROPOSE_MAX_ROWS}`);
        expect(tool.input_schema.properties.table.description).not.toContain('current');
        // Ask AI's own tool is unchanged
        const own = ask_tool(COLUMNS, true);
        expect((own.input_schema as any).required).toBeUndefined();
        expect(own.input_schema.properties.limit.maximum).toBe(ASK_MAX_ROWS);
    });

    it('only takes the read-only query keys', () => {
        expect(() => parse_ask_input({ cursor: 'x' }, COLUMNS)).toThrow(/Unknown key: cursor/);
        expect(() => parse_ask_input({ explain: true }, COLUMNS)).toThrow(/Unknown key/);
        expect(() => parse_ask_input({ update: { a: 1 } }, COLUMNS)).toThrow(/Unknown key/);
        expect(() => parse_ask_input({ $where: 'sleep(1)' }, COLUMNS)).toThrow(AskError);
        expect(() => parse_ask_input('{"filters":[]}', COLUMNS)).toThrow(AskError);
        expect(() => parse_ask_input([], COLUMNS)).toThrow(AskError);
    });

    it('checks columns, operators and values against the schema', () => {
        const bad = [
            { filters: [{ column: 'Nope', op: 'eq', value: 'x' }] },
            { filters: [{ column: 'Supplier', op: 'eq', value: 'x' }] },
            { filters: [{ column: 'Price', op: '$where', value: 'x' }] },
            { filters: [{ column: 'Price', op: 'eq', value: 'ten' }] },
            { filters: [{ column: 'Price', op: 'eq', value: { $gt: 1 } }] },
            { filters: [{ column: 'Added', op: 'gt', value: 'not a date' }] },
            { filters: [{ column: 'Price', op: 'contains', value: '1' }] },
            { sort: [{ column: 'Nope' }] },
            { fields: ['Nope'] }
        ];
        bad.forEach(input => expect(() => parse_ask_input(input, COLUMNS)).toThrow(AskError));
        // Text values never become operators: a string stays a string
        const ask = parse_ask_input(
            { filters: [{ column: 'Name', op: 'contains', value: '.*' }] },
            COLUMNS
        );
        expect(ask.query.filter).toEqual({
            $and: [{ a: { $regex: '\\.\\*', $options: 'i' } }]
        });
    });
});

describe('ask_tool', () => {
    it('names the columns in an enum and caps the limit', () => {
        const tool = ask_tool(COLUMNS);
        expect(tool.name).toBe(ASK_TOOL_NAME);
        const props: any = tool.input_schema.properties;
        expect(props.fields.items.enum).toEqual(['Name', 'Price', 'Added']);
        expect(props.filters.items.properties.column.enum).toEqual([
            'Name',
            'Price',
            'Added',
            '_id'
        ]);
        expect(props.limit.maximum).toBe(ASK_MAX_ROWS);
        expect(Object.keys(props).sort()).toEqual(['fields', 'filters', 'limit', 'match', 'sort']);
    });

    it('takes a table when the account has other tables (#322)', () => {
        const props: any = ask_tool(COLUMNS, true).input_schema.properties;
        expect(props.table.type).toBe('string');
        // Another table's columns aren't in this table's enum
        expect(props.fields.items.enum).toBeUndefined();
        expect(props.filters.items.properties.column.enum).toBeUndefined();
        expect(props.limit.maximum).toBe(ASK_MAX_ROWS);
    });

    it('leaves room to read another table, then propose (#322)', () => {
        expect(ASK_MAX_TURNS).toBe(4);
    });
});

describe("the account's other tables (#322)", () => {
    const TABLES = [
        { id: 1, name: 'Products' },
        { id: 2, name: 'email_campaign_events' },
        { id: 3, name: 'Twin' },
        { id: 4, name: ' twin' }
    ];

    it('resolves a table by name, ignoring case, or the current table without one', () => {
        expect(resolve_ask_table({}, TABLES)).toBeNull();
        expect(resolve_ask_table({ table: '' }, TABLES)).toBeNull();
        expect(resolve_ask_table({ table: null }, TABLES)).toBeNull();
        expect(resolve_ask_table({ table: ' Email_Campaign_Events ' }, TABLES)).toBe(TABLES[1]);
    });

    it("refuses a table that isn't one of the given ones, or an ambiguous name", () => {
        expect(() => resolve_ask_table({ table: 'Theirs' }, TABLES)).toThrow(
            'There is no table named "Theirs" in this account'
        );
        expect(() => resolve_ask_table({ table: 'twin' }, TABLES)).toThrow(
            '2 tables are named "twin"'
        );
        expect(() => resolve_ask_table({ table: 7 }, TABLES)).toThrow(AskError);
        expect(() => resolve_ask_table({ table: 'Products' }, [])).toThrow(AskError);
    });

    it('accepts table in the input but leaves it out of the API body', () => {
        const ask = parse_ask_input({ table: 'Products', fields: ['Name'] }, COLUMNS);
        expect(ask.body).toEqual({ fields: ['Name'], limit: ASK_DEFAULT_ROWS });
    });

    it('caps the tables and columns listed in the prompt, and says what was cut', () => {
        const many_cols = Array.from({ length: 50 }, (_, i) => ({
            name: `c${i}`,
            header_name: `c${i}`,
            field: `f${i}`,
            type: 'string' as const
        }));
        const tables = Array.from({ length: 35 }, (_, i) => ({
            name: `t${i}`,
            columns: i === 0 ? many_cols : COLUMNS
        }));
        const listed = prompt_tables(tables, 40);
        expect(listed.tables).toHaveLength(ASK_PROMPT_MAX_TABLES);
        expect(listed.tables[0].columns).toHaveLength(ASK_PROMPT_MAX_COLUMNS);
        expect(listed.tables[0].more_columns).toBe(10);
        expect(listed.tables[1].more_columns).toBe(0);
        expect(listed.more_tables).toBe(10);

        const prompt = ask_system_prompt('Products', COLUMNS, [], '2026-11-27', [], listed);
        expect(prompt).toContain('- "t1": "Name" (string), "Price" (number), "Added" (date)');
        expect(prompt).toContain('and 10 more columns not listed');
        expect(prompt).toContain('(and 10 more tables not listed)');
        expect(prompt).toContain('New rows and edits are only ever for "Products"');
        expect(prompt).not.toContain('"t30"');
        expect(prompt).not.toContain('"c40"');
        // No rows of other tables in the prompt
        expect(prompt).not.toContain('"t1": [');
    });

    it('says nothing of other tables when there are none', () => {
        const prompt = ask_system_prompt('Products', COLUMNS, [], '2026-11-27');
        expect(prompt).not.toContain('other tables');
    });
});

describe('propose_rows', () => {
    it('takes a description and a count', () => {
        expect(parse_propose_input({ description: ' people ', count: 3 })).toEqual({
            prompt: 'people',
            count: 3
        });
        expect(() => parse_propose_input({ count: 3 })).toThrow(AskError);
    });

    it('takes explicit rows (#322), counted by their number', () => {
        const rows = [{ Name: 'a@x.com' }, { Name: 'b@x.com' }];
        expect(parse_propose_input({ rows })).toEqual({ prompt: '', count: 2, rows });
        expect(parse_propose_input({ rows, count: 50, description: 'd' }).count).toBe(2);
        expect(() => parse_propose_input({ rows: [] })).toThrow(AskError);
        expect(() => parse_propose_input({ rows: 'x' })).toThrow(AskError);
        expect(() => parse_propose_input({ rows: [1, 2] })).toThrow(AskError);
        expect(() => parse_propose_input({ rows: [[]] })).toThrow(AskError);
        const too_many = Array.from({ length: PROPOSE_MAX_ROWS + 1 }, () => ({ Name: 'x' }));
        expect(() => parse_propose_input({ rows: too_many })).toThrow(AskError);
        const props: any = propose_tool().input_schema.properties;
        expect(props.rows.maxItems).toBe(PROPOSE_MAX_ROWS);
    });
});

describe('prompt and results', () => {
    it('puts the table, columns and samples in the system prompt', () => {
        const prompt = ask_system_prompt('Products', COLUMNS, [{ Name: 'Pen' }], '2026-11-25');
        expect(prompt).toContain('"Products"');
        expect(prompt).toContain('"Price" (number)');
        expect(prompt).toContain('"Added" (date)');
        expect(prompt).toContain('{"Name":"Pen"}');
        expect(prompt).toContain('2026-11-25');
        expect(prompt).not.toContain('Supplier');
    });

    it('cuts long cells short for the model', () => {
        const long = 'x'.repeat(1000);
        const [row] = rows_for_model([{ Name: long, Price: 3 }]);
        expect((row.Name as string).length).toBeLessThan(300);
        expect(row.Price).toBe(3);
        expect(JSON.parse(tool_result_content(7, [{ Price: 3 }]))).toEqual({
            total_matching: 7,
            returned: 1,
            rows: [{ Price: 3 }]
        });
    });

    it('builds the equivalent API call', () => {
        const body = { filters: [{ column: 'Price', op: 'gt', value: 10 }], limit: 5 };
        const call = api_call('http://x/api/v1/', 'My table', body);
        expect(call.method).toBe('POST');
        expect(call.url).toBe('http://x/api/v1/query?table=My%20table');
        expect(call.body).toBe(body);
        expect(call.curl).toContain("curl -X POST 'http://x/api/v1/query?table=My%20table'");
        expect(call.curl).toContain('"op": "gt"');
    });

    it('reads the text of a reply', () => {
        expect(
            reply_text([
                { type: 'tool_use', id: 't', name: 'run_query', input: {} },
                { type: 'text', text: ' Three rows. ' }
            ])
        ).toBe('Three rows.');
        expect(reply_text(undefined)).toBe('');
    });
});

describe('questions and usage', () => {
    it('checks the question', () => {
        expect(parse_question('  how many?  ')).toBe('how many?');
        expect(() => parse_question('')).toThrow(AskError);
        expect(() => parse_question('   ')).toThrow(AskError);
        expect(() => parse_question(42)).toThrow(AskError);
        expect(() => parse_question('x'.repeat(MAX_QUESTION_LENGTH + 1))).toThrow(AskError);
    });
});
