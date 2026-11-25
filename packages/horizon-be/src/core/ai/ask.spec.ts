import {
    AI_QUESTION_LIMITS,
    ASK_DEFAULT_ROWS,
    ASK_MAX_ROWS,
    ASK_TOOL_NAME,
    AskError,
    MAX_QUESTION_LENGTH,
    api_call,
    ask_columns,
    ask_system_prompt,
    ask_tool,
    parse_ask_input,
    parse_question,
    question_limit,
    reply_text,
    rows_for_model,
    tier_of,
    tool_result_content,
    usage_month
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

    it('maps subscriptions to tiers and limits', () => {
        expect(tier_of(null)).toBe('FREE');
        expect(tier_of('SUB_FREE')).toBe('FREE');
        expect(tier_of('SUB_TEST_BASIC')).toBe('BASIC');
        expect(tier_of('SUB_LIVE_PLUS')).toBe('PLUS');
        expect(tier_of('SUB_LIVE_PREMIUM')).toBe('PREMIUM');
        expect(tier_of('SUB_SOMETHING_ELSE')).toBe('FREE');
        expect(question_limit(undefined)).toBe(AI_QUESTION_LIMITS.FREE);
        expect(question_limit('SUB_LIVE_PLUS')).toBe(AI_QUESTION_LIMITS.PLUS);
        expect(AI_QUESTION_LIMITS.FREE).toBeLessThan(AI_QUESTION_LIMITS.BASIC);
        expect(AI_QUESTION_LIMITS.BASIC).toBeLessThan(AI_QUESTION_LIMITS.PLUS);
        expect(AI_QUESTION_LIMITS.PLUS).toBeLessThan(AI_QUESTION_LIMITS.PREMIUM);
    });

    it('counts by UTC month', () => {
        expect(usage_month(Date.UTC(2026, 10, 30, 23, 59))).toBe('2026-11');
        expect(usage_month(Date.UTC(2026, 11, 1, 0, 0))).toBe('2026-12');
    });
});
