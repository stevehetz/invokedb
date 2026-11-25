// Loads the example tables into a running InvokeDB backend and writes the Angular example's
// config file:
//
//   node examples/setup.mjs [--base http://127.0.0.1:8001] [--email demo@invokedb.com]
//                           [--password password] [--replace]
//
// For each CSV in examples/data it uploads a table (todo, contacts, wine_reviews), waits for the
// processor, then sets the column types and indexes the examples rely on. Tables that already
// exist are left alone unless you pass --replace, which deletes and re-creates them.
// Finally it writes examples/angular/public/invokedb.config.json (gitignored) with a read-write
// API key it makes for the account ("Examples (setup.mjs)", replacing the last run's), so
// `npm start` in examples/angular works straight away.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values: opts } = parseArgs({
    options: {
        base: { type: 'string', default: 'http://127.0.0.1:8001' },
        email: { type: 'string', default: 'demo@invokedb.com' },
        password: { type: 'string', default: 'password' },
        replace: { type: 'boolean', default: false }
    }
});
const BASE = opts.base.replace(/\/+$/, '');

// Table name → CSV file, column types (default string) and indexed columns
const TABLES = [
    {
        name: 'todo',
        csv: 'todo.csv',
        types: { due_date: 'date' },
        indexed: ['is_complete']
    },
    {
        name: 'contacts',
        csv: 'contacts.csv',
        types: { dob: 'date' },
        indexed: ['first_name', 'last_name']
    },
    {
        name: 'wine_reviews',
        csv: 'wine_reviews.csv',
        types: { vintage: 'number', price: 'number', points: 'number' },
        indexed: ['title', 'variety', 'country', 'price', 'points']
    }
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, url, { token, body, form } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload = form;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    let res;
    try {
        res = await fetch(BASE + url, { method, headers, body: payload });
    } catch (e) {
        throw new Error(
            `Can't reach ${BASE} (${e.cause?.code || e.message}). Is the backend running?`
        );
    }
    const text = await res.text();
    let data = text;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {}
    if (!res.ok) {
        throw new Error(`${method} ${url} failed (${res.status}): ${JSON.stringify(data)}`);
    }
    return data;
}

const session = await call('POST', '/auth/login', {
    body: { email: opts.email, password: opts.password }
});
const token = session.token;
const me = await call('GET', `/auth/authorize?token=${token}`);

// API keys are only shown when they're made (#138), so each run makes a fresh read-write key for
// the examples and revokes the one the last run made
const KEY_NAME = 'Examples (setup.mjs)';
const { keys } = await call('GET', '/api-key', { token });
for (const old of keys.filter(k => k.name === KEY_NAME && !k.revoked_datetime)) {
    await call('DELETE', `/api-key/${old.id}`, { token });
}
const { secret: api_key } = await call('POST', '/api-key', {
    token,
    body: { name: KEY_NAME, access: 'read_write' }
});
console.log(`Logged in as ${opts.email} (account ${me.id}) at ${BASE}`);

const listTables = () => call('GET', `/file-directory?account_id=${me.id}`, { token });

async function waitUntilReady(file_id) {
    for (let i = 0; i < 120; i++) {
        const file = (await listTables()).find(d => d.id === file_id);
        if (!file) throw new Error(`table ${file_id} disappeared`);
        if (file.status === 'ERROR') throw new Error(`processing failed: ${file.status_reason}`);
        if (!file.status) return;
        await sleep(500);
    }
    throw new Error(`table ${file_id} still processing after 60s`);
}

for (const table of TABLES) {
    const existing = (await listTables()).find(
        d => d.name.toLowerCase() === table.name.toLowerCase()
    );
    if (existing && !opts.replace) {
        // Table names match case-insensitively, so an unrelated older table (e.g. "Todo") can
        // stand in for ours. Check it has the CSV's columns before calling it good.
        const header = fs
            .readFileSync(path.join(here, 'data', table.csv), 'utf8')
            .split(/\r?\n/, 1)[0];
        const cols = await call(
            'POST',
            `/web-file/data_grid_column/${existing.id}?skip=0&limit=100`,
            {
                token,
                body: {}
            }
        );
        const have = new Set(cols.data.map(c => c.headerName));
        const missing = header.split(',').filter(c => !have.has(c));
        if (missing.length) {
            console.warn(
                `- ${table.name}: WARNING, existing table "${existing.name}" is missing ` +
                    `${missing.join(', ')}; the example won't work with it. ` +
                    `Re-run with --replace to re-create it.`
            );
        } else {
            console.log(`- ${table.name}: already exists, skipped (use --replace to re-create it)`);
        }
        continue;
    }
    if (existing) {
        await call('POST', '/file-directory/batch_delete', { token, body: { ids: [existing.id] } });
    }

    const csv = fs.readFileSync(path.join(here, 'data', table.csv));
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), table.csv);
    form.append('new_name', table.name);
    form.append('account_id', String(me.id));
    const file_id = await call('POST', '/web-file/file_upload', { token, form });
    await waitUntilReady(file_id);

    const cols = await call('POST', `/web-file/data_grid_column/${file_id}?skip=0&limit=100`, {
        token,
        body: {}
    });
    const changed = cols.data
        .filter(c => table.types[c.headerName] || table.indexed.includes(c.headerName))
        .map(c => ({
            ...c,
            col_type: table.types[c.headerName] || c.col_type || 'string',
            indexed: table.indexed.includes(c.headerName) || !!c.indexed
        }));
    if (changed.length) {
        await call('PUT', `/web-file/batch_update_job/data_grid_column/${file_id}`, {
            token,
            body: changed
        });
        await waitUntilReady(file_id);
    }

    const rows = await call('GET', `/api/v1/get?table=${table.name}&skip=0&limit=1`, {
        token: api_key
    });
    console.log(`- ${table.name}: ${existing ? 're-created' : 'created'}, ${rows.count} rows`);
}

const configPath = path.join(here, 'angular', 'public', 'invokedb.config.json');
fs.writeFileSync(
    configPath,
    JSON.stringify({ apiKey: api_key, baseUrl: `${BASE}/api/v1` }, null, 2) + '\n'
);
console.log(`\nAPI key (${KEY_NAME}): ${api_key}`);
console.log(`Wrote ${path.relative(process.cwd(), configPath)}`);
