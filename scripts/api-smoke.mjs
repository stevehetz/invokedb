// API smoke test for horizon-be: node scripts/api-smoke.mjs [base_url] [out.json]
// Exits non-zero if any call or check fails (CI runs it: .github/workflows/ci.yml, `smoke`).
// Logs in as demo@invokedb.com, uploads a small CSV as table "smoke_people", exercises the
// grid + external /api/v1 endpoints, checks that demo2@invokedb.com can't reach demo's tables
// or account, checks each account's onboarding checklist (#143: runs its curl command, ticks,
// dismisses demo2's), makes tables from templates, reads the
// table's generated API docs and OpenAPI spec and runs their curl, fetch and Python snippets
// (#139; Python only if python3 is installed), checks /api/v1/query and /count (#141: filters,
// sort, fields, cursor paging, index use, 400s), imports tables from a CSV and a JSON URL (#144:
// refused private/loopback URLs, replace and upsert re-syncs (a replace clears links to the old
// rows, #175), a failed sync, demo2 locked out;
// the URLs are this repo's files on GitHub, so it needs internet), checks webhooks on row changes
// (#140: a receiver on 127.0.0.1:8199, allowed by smoke-env.sh's HORIZON_WEBHOOK_TEST_HOSTS,
// checks signatures; refused private URLs, a retry, demo2 locked out), checks shareable forms
// (#145: public view and submissions, typed answers, honeypot, closing, the rate limit, deleted
// forms and tables, demo2 locked out), checks saved views (#146: grid views saved, renamed and
// deleted, a kanban board and a moved card, bar/pie/line charts, a calendar's days and a map's
// points (#211), demo2 and API keys locked out, a deleted table's views gone), checks link
// columns (#147: picker, grid labels, ids and
// `expand` on /api/v1, bad links refused, deleted rows cleared from links, no links across
// accounts; a deleted linked table empties the cells and makes the column a string, #175; the
// schema diagram draws the tables and the link, #208, demo2 and API keys locked out),
// checks "ask your data" (#149: a stub of the Anthropic API on 127.0.0.1:8197, set by
// smoke-env.sh; answer, rows and the API call, bad model queries refused, the monthly cap, demo2
// and API keys locked out; then AI rows and tables, #148: typed preview rows, the monthly row
// allowance, demo2 locked out), checks API keys (#138: made for each account and revoked at the end;
// read-only and table-scoped keys refused, revoked keys refused, only hashes listed, demo's
// migrated key still works, demo2 locked out; #216: a key's own rate limit answers 429 with
// Retry-After, its request log has no query strings and is the owner's only) and email verification on signup (#132: the same
// answer for a taken email, an unverified account with no API key and no tables, resend, bad
// links), checks two-factor sign-in on demo6 (#214: setup and QR code, the login's code step,
// replayed and reused codes refused, recovery codes, demo2 and API keys locked out, turned off
// again), checks the admin area (#277: demo6 is smoke-env.sh's HORIZON_ADMIN_EMAILS and an admin
// only with two-factor on; demo, API keys and no token get 404; the overview, the accounts list
// and an account's page; plan, lock, verification email, 2FA reset and delete on a new account,
// each in its history), checks data export (#215: the processor's zip has every table as CSV and JSON and the
// settings without webhook secrets; one at a time; demo2 and API keys can't download it), checks the
// audit log (#217: app and API key changes per table and per account, paging, demo2 and API keys
// locked out), checks the light/dark theme choice (#290: saved and answered by authorize, bad
// values, API keys and no token refused), checks the plans (#183: public GET /plans; on demo7, put on Free with tiny caps by
// smoke-env.sh's HORIZON_TEST_PLANS, every cap refused on each path with 403 `plan_limit`, the
// monthly API quota with 429; demo6 on Starter; GET /usage matches and is the caller's own),
// checks the read-only state (#184: demo5 moved from Pro to a tiny Free by the test-only
// PUT /test-plan reads, exports and deletes, every write path refused with 403
// `plan_read_only`, writable again once deleted down to the caps), checks that deleting an
// account (its own or the admin's) deletes its data at once (#279: read from Mongo through the
// backend's driver and HORIZON_ENV_FILE, and its email signs up again), then deletes the tables and the new account. Writes every response to out.json
// so two runs (e.g. before/after an upgrade) can be diffed. Best run against throwaway DBs
// (HORIZON_ENV_FILE=<alt env> with different DB names) rather than your local data.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const BASE = process.argv[2] || 'http://127.0.0.1:8001';
const OUT = process.argv[3];
const results = {};
let failures = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(name, method, path, { token, body, form, expectFail } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, { method, headers, body: payload });
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }
    results[name] = { status: res.status, data };
    const ok = res.status < 400;
    if (ok !== !expectFail) failures++;
    console.log(`${ok === !expectFail ? 'ok  ' : 'FAIL'} ${res.status} ${name}`);
    if (ok === !!expectFail) console.log('     ', redacted(data).slice(0, 300));
    return data;
}

// CI logs are public: never print a key or secret from a response, even a throwaway one
function redacted(value) {
    return JSON.stringify(value, (k, v) =>
        /^(secret|api_key|key|token)$/i.test(k) && typeof v === 'string' ? `${v.slice(0, 6)}…` : v
    );
}

function check(name, pass, detail) {
    results[name] = pass;
    if (!pass) failures++;
    console.log(`${pass ? 'ok  ' : 'FAIL'} --- ${name}`);
    if (!pass && detail !== undefined) console.log('     ', redacted(detail).slice(0, 300));
}

// Wait until the backend's websocket clients are registered (GET /health answers 200): they
// connect about a second after HTTP is up, and an upload before then used to crash it (#44).
for (let i = 0; ; i++) {
    const res = await fetch(BASE + '/health').catch(() => null);
    if (res?.ok) break;
    if (i >= 60) {
        console.log(`FAIL --- /health not ready after 30s (last status ${res?.status})`);
        process.exit(1);
    }
    await sleep(500);
}

const session = await call('login', 'POST', '/auth/login', {
    body: { email: 'demo@invokedb.com', password: 'password' }
});
const token = session.token;
await call('login_bad_password', 'POST', '/auth/login', {
    body: { email: 'demo@invokedb.com', password: 'nope' },
    expectFail: true
});
await call('login_no_email', 'POST', '/auth/login', {
    body: { password: 'password' },
    expectFail: true
});
const me = await call('authorize', 'GET', `/auth/authorize?token=${token}`);
check('authorize_has_no_api_key', me && !('api_key' in me), me);
// The account menu's plan comes from the plan constant (#275)
check(
    'authorize_plan',
    me &&
        ['FREE', 'STARTER', 'PRO'].includes(me.plan?.id) &&
        typeof me.plan?.name === 'string' &&
        typeof me.plan?.internal === 'boolean' &&
        !('subscription' in me),
    me
);
// API keys (#138) are only shown when they're made, so the test makes a read-write key for every
// table per account (me.api_key, other_me.api_key) and revokes them at the end
const smoke_keys = [];
async function make_key(name, tok, body) {
    const made = await call(name, 'POST', '/api-key', { token: tok, body });
    if (made?.key?.id) smoke_keys.push({ id: made.key.id, owner: tok });
    return made;
}
me.api_key = (
    await make_key('api_key_create', token, { name: 'smoke', access: 'read_write' })
)?.secret;
// The app's light/dark theme (#290): saved on the account, answered by authorize; only the
// three choices, and only with a session (not an API key)
check('theme_authorize', ['system', 'light', 'dark'].includes(me?.theme), me?.theme);
await call('theme_set_dark', 'PUT', '/account/theme', { token, body: { theme: 'dark' } });
const theme_me = await call('theme_authorize_dark', 'GET', `/auth/authorize?token=${token}`);
check('theme_saved', theme_me?.theme === 'dark', theme_me?.theme);
await call('theme_bad_value', 'PUT', '/account/theme', {
    token,
    body: { theme: 'purple' },
    expectFail: true
});
await call('theme_api_key', 'PUT', '/account/theme', {
    token: me.api_key,
    body: { theme: 'light' },
    expectFail: true
});
await call('theme_no_token', 'PUT', '/account/theme', {
    body: { theme: 'light' },
    expectFail: true
});
const theme_after = await call('theme_authorize_after', 'GET', `/auth/authorize?token=${token}`);
check('theme_unchanged_by_refused', theme_after?.theme === 'dark', theme_after?.theme);
await call('theme_restore', 'PUT', '/account/theme', { token, body: { theme: me?.theme } });
await call('authorize_no_token', 'GET', '/auth/authorize');
await call('confirm_reset_no_token', 'GET', '/auth/confirm-reset-token', { expectFail: true });
await call('unauth_web_file', 'POST', '/web-file/data_grid_row/1?skip=0&limit=1', {
    expectFail: true
});
await call('plan_tiers_gone', 'GET', '/subscription/plan-tiers', { token, expectFail: true });

// Upload a CSV and wait for the processor to finish
const csv = 'name,age,joined\nalice,30,2020-01-02\nbob,41,2021-05-06\ncarol,25,2019-12-31\n';
const form = new FormData();
form.append('file', new Blob([csv], { type: 'text/csv' }), 'people.csv');
form.append('new_name', 'smoke_people');
form.append('account_id', String(me.id));
const file_id = await call('file_upload', 'POST', '/web-file/file_upload', { token, form });

let file;
for (let i = 0; i < 40; i++) {
    const dirs = await call('file_directory_list', 'GET', `/file-directory?account_id=${me.id}`, {
        token
    });
    file = dirs.find(d => d.id === file_id);
    if (file && file.status !== 'PENDING' && file.status !== 'PROCESSING') break;
    await sleep(1000);
}
results.file_status = file && file.status;
console.log('     file status:', file && file.status);

const rows = await call('get_rows', 'POST', `/web-file/data_grid_row/${file_id}?skip=0&limit=10`, {
    token,
    body: {}
});
const cols = await call(
    'get_cols',
    'POST',
    `/web-file/data_grid_column/${file_id}?skip=0&limit=50`,
    { token, body: {} }
);
await call('get_rows_filter', 'POST', `/web-file/data_grid_row/${file_id}?skip=0&limit=10`, {
    token,
    body: { a: { type: 'contains', value: 'o' } }
});
await call(
    'get_rows_nested_query',
    'POST',
    `/web-file/data_grid_row/${file_id}?skip=0&limit=10&sort[a]=desc`,
    { token, body: {} }
);
await call('new_column', 'GET', `/web-file/${file_id}/get_new_column`, { token });

const row0 = rows.data && rows.data[0];
if (row0) {
    await call('update_row', 'PUT', `/web-file/${row0._id}/data_grid_row/${file_id}`, {
        token,
        body: { ...row0, a: 'alice2' }
    });
}
const ageCol = cols.data && cols.data.find(c => c.headerName === 'age');
if (ageCol) {
    await call('update_col_type', 'PUT', `/web-file/${ageCol._id}/data_grid_column/${file_id}`, {
        token,
        body: { ...ageCol, col_type: 'number', indexed: true }
    });
    await sleep(500);
    await call(
        'get_rows_after_type',
        'POST',
        `/web-file/data_grid_row/${file_id}?skip=0&limit=10`,
        { token, body: {} }
    );
}
await call('batch_create_rows', 'POST', `/web-file/batch_create/data_grid_row/${file_id}`, {
    token,
    body: [{ a: 'dave', b: 50 }]
});

// Another account (demo2) must not see or change demo's tables or account
const other = await call('other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const otoken = other.token;
const other_list = await call('other_list_spoofed', 'GET', `/file-directory?account_id=${me.id}`, {
    token: otoken
});
check(
    'other_list_spoofed_is_own',
    Array.isArray(other_list) && other_list.every(d => d.account_id !== me.id),
    other_list
);
await call('other_rename', 'PUT', `/file-directory/${file_id}`, {
    token: otoken,
    body: { id: file_id, account_id: me.id, name: 'hijacked' },
    expectFail: true
});
await call('other_batch_delete', 'POST', '/file-directory/batch_delete', {
    token: otoken,
    body: { ids: [file_id] },
    expectFail: true
});
await call('other_get_rows', 'POST', `/web-file/data_grid_row/${file_id}?skip=0&limit=10`, {
    token: otoken,
    body: {},
    expectFail: true
});
await call('other_batch_create', 'POST', `/web-file/batch_create/data_grid_row/${file_id}`, {
    token: otoken,
    body: [{ a: 'mallory' }],
    expectFail: true
});
await call('other_update_account', 'PUT', `/account/update_account/${me.id}`, {
    token: otoken,
    body: { first_name: 'hijacked', last_name: 'hijacked' },
    expectFail: true
});
await call('other_delete_account', 'PUT', `/account/delete_account/${me.id}`, {
    token: otoken,
    expectFail: true
});
await call('unauth_update_account', 'PUT', `/account/update_account/${me.id}`, {
    body: { first_name: 'hijacked', last_name: 'hijacked' },
    expectFail: true
});
await call('unauth_list_accounts', 'POST', '/account', { body: {}, expectFail: true });
await call(
    'session_token_on_external_api',
    'GET',
    '/api/v1/get?table=smoke_people&skip=0&limit=1',
    {
        token,
        expectFail: true
    }
);
await call('api_key_on_internal_route', 'GET', '/file-directory', {
    token: me.api_key,
    expectFail: true
});
// A body account_id is ignored: the folder is created in demo2's own account...
const other_dir = await call('other_create_spoofed', 'POST', '/file-directory', {
    token: otoken,
    body: { account_id: me.id, name: 'smoke_other_dir', type: 'dir' }
});
const own_list = await call('own_list', 'GET', `/file-directory?account_id=${me.id}`, { token });
check(
    'other_create_spoofed_not_in_own_account',
    Array.isArray(own_list) && !own_list.some(d => d.id === other_dir),
    own_list
);
// ...and demo can't put a table (or move one) into demo2's folder
await call('create_in_other_folder', 'POST', '/file-directory', {
    token,
    body: {
        account_id: me.id,
        name: 'smoke_x',
        type: 'file',
        web_file_type: 'data-grid',
        parent_id: other_dir
    },
    expectFail: true
});
await call('move_into_other_folder', 'PUT', `/file-directory/${file_id}`, {
    token,
    body: { id: file_id, account_id: me.id, name: 'smoke_people', parent_id: other_dir },
    expectFail: true
});
await call('other_delete_own_dir', 'POST', '/file-directory/batch_delete', {
    token: otoken,
    body: { ids: [other_dir] }
});

// Table templates (#142): demo makes a table from one; demo2 can't see or use it
const templates = await call('template_list', 'GET', '/table-template', { token });
check(
    'template_list_has_four',
    Array.isArray(templates) && templates.length >= 4 && templates.some(t => t.id === 'crm'),
    templates
);
await call('template_list_unauth', 'GET', '/table-template', { expectFail: true });
await call('template_list_api_key', 'GET', '/table-template', {
    token: me.api_key,
    expectFail: true
});
const tpl_id = await call('template_create', 'POST', '/table-template/crm', {
    token,
    body: { name: 'smoke_crm' }
});
const crm = templates.find?.(t => t.id === 'crm');
const tpl_cols = await call(
    'template_cols',
    'POST',
    `/web-file/data_grid_column/${tpl_id}?skip=0&limit=50`,
    { token, body: {} }
);
check(
    'template_cols_match',
    !!crm &&
        JSON.stringify((tpl_cols.data || []).map(c => [c.headerName, c.col_type])) ===
            JSON.stringify(crm.columns.map(c => [c.name, c.type])),
    tpl_cols
);
const tpl_rows = await call(
    'template_rows',
    'POST',
    `/web-file/data_grid_row/${tpl_id}?skip=0&limit=50`,
    { token, body: {} }
);
const value_col = (tpl_cols.data || []).find(c => c.headerName === 'Deal Value');
check(
    'template_rows_typed',
    !!crm &&
        tpl_rows.count === crm.row_count &&
        !!value_col &&
        tpl_rows.data.every(r => typeof r[value_col.field] === 'number'),
    tpl_rows
);
await call('template_create_name_in_use', 'POST', '/table-template/crm', {
    token,
    body: { name: 'smoke_crm' },
    expectFail: true
});
await call('template_create_bad_name', 'POST', '/table-template/crm', {
    token,
    body: { name: 'bad name' },
    expectFail: true
});
await call('template_unknown', 'POST', '/table-template/no-such-template', {
    token,
    body: { name: 'smoke_none' },
    expectFail: true
});
await call('template_in_other_folder', 'POST', '/table-template/tasks', {
    token,
    body: { name: 'smoke_tasks_x', parent_id: other_dir },
    expectFail: true
});
await call('template_api_key', 'POST', '/table-template/tasks', {
    token: me.api_key,
    body: { name: 'smoke_tasks_key' },
    expectFail: true
});
await call('other_template_rows', 'POST', `/web-file/data_grid_row/${tpl_id}?skip=0&limit=10`, {
    token: otoken,
    body: {},
    expectFail: true
});
const other_me = await call('other_authorize', 'GET', `/auth/authorize?token=${otoken}`);
other_me.api_key = (
    await make_key('other_api_key_create', otoken, { name: 'smoke', access: 'read_write' })
)?.secret;
await call('other_ext_template_table', 'GET', '/api/v1/get?table=smoke_crm&skip=0&limit=1', {
    token: other_me.api_key,
    expectFail: true
});
// Per-table API docs (#139): demo2 can't read the docs or OpenAPI spec of demo's table
await call('other_api_docs', 'GET', `/web-file/${file_id}/api-docs`, {
    token: otoken,
    expectFail: true
});
await call('other_openapi', 'GET', `/web-file/${file_id}/openapi.json`, {
    token: otoken,
    expectFail: true
});
await call('other_ext_openapi', 'GET', '/api/v1/openapi?table=smoke_people', {
    token: other_me.api_key,
    expectFail: true
});
// Richer queries (#141): demo2's key can't query or count demo's table, nor a session token
await call('other_ext_query', 'POST', '/api/v1/query?table=smoke_people', {
    token: other_me.api_key,
    body: {},
    expectFail: true
});
await call('other_ext_count', 'POST', '/api/v1/count?table=smoke_people', {
    token: other_me.api_key,
    body: {},
    expectFail: true
});
await call('ext_query_session_token', 'POST', '/api/v1/query?table=smoke_people', {
    token,
    body: {},
    expectFail: true
});
await call('api_docs_unauth', 'GET', `/web-file/${file_id}/api-docs`, { expectFail: true });
await call('api_docs_api_key', 'GET', `/web-file/${file_id}/api-docs`, {
    token: me.api_key,
    expectFail: true
});
await call('ext_openapi_session_token', 'GET', '/api/v1/openapi?table=smoke_people', {
    token,
    expectFail: true
});
await call('other_delete_template_table', 'POST', '/file-directory/batch_delete', {
    token: otoken,
    body: { ids: [tpl_id] },
    expectFail: true
});

// demo2's template table is its own, not demo's. (A template at the plan's table cap is refused
// in the plans section below, #183: the demo accounts have no caps.)
const other_tpl_ids = [
    await call('other_template_create', 'POST', '/table-template/waitlist', {
        token: otoken,
        body: { name: 'smoke_waitlist_theirs' }
    })
];
const own_list_tpl = await call('own_list_after_templates', 'GET', '/file-directory', { token });
check(
    'other_templates_not_in_own_account',
    Array.isArray(own_list_tpl) && !own_list_tpl.some(d => other_tpl_ids.includes(d.id)),
    own_list_tpl
);
await call('other_template_cleanup', 'POST', '/file-directory/batch_delete', {
    token: otoken,
    body: { ids: other_tpl_ids }
});
await call('template_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [tpl_id] }
});

// Import from a URL (#144). Private, loopback and non-http URLs are a 400 and make no table; a
// CSV and a JSON URL (this repo's own files on GitHub, so CI needs internet) become tables;
// re-syncs replace or upsert, and a failed one leaves the rows alone; demo2 can't read,
// change or sync demo's.
const RAW = 'https://raw.githubusercontent.com/stevehetz/invokedb/main';
const refused_urls = {
    this_backend: `${BASE}/health`,
    loopback: 'http://127.0.0.1/',
    loopback_short: 'http://127.1/',
    localhost: 'http://localhost/',
    metadata: 'http://169.254.169.254/latest/meta-data/',
    private_v4: 'http://10.0.0.1/data.csv',
    ipv6_loopback: 'http://[::1]/',
    mapped_v4: 'http://[::ffff:127.0.0.1]/',
    other_port: 'https://raw.githubusercontent.com:8443/a.csv',
    file_scheme: 'file:///etc/passwd',
    credentials: 'https://user:pw@example.com/a.csv'
};
for (const [name, url] of Object.entries(refused_urls)) {
    await call(`url_import_refused_${name}`, 'POST', '/url-import', {
        token,
        body: { new_name: `smoke_url_${name}`, url },
        expectFail: true
    });
    check(
        `url_import_refused_${name}_is_400`,
        results[`url_import_refused_${name}`].status === 400
    );
}
await call('url_import_upsert_no_key', 'POST', '/url-import', {
    token,
    body: { new_name: 'smoke_url_nokey', url: `${RAW}/examples/data/todo.csv`, mode: 'upsert' },
    expectFail: true
});
const after_refused = await call('url_import_list_after_refused', 'GET', '/file-directory', {
    token
});
check(
    'url_import_refused_made_no_table',
    Array.isArray(after_refused) && !after_refused.some(d => d.name.startsWith('smoke_url_')),
    after_refused
);

// Waits for a table's import or sync to finish; answers its source
async function url_source_settled(name, id) {
    let source;
    for (let i = 0; i < 60; i++) {
        source = (await call(name, 'GET', `/url-import/${id}`, { token }))?.source;
        if (source && source.last_status !== 'PENDING') break;
        await sleep(1000);
    }
    return source;
}
const row_count = async (name, id) =>
    (
        await call(name, 'POST', `/web-file/data_grid_row/${id}?skip=0&limit=100`, {
            token,
            body: {}
        })
    )?.count;

const todo_lines = fs
    .readFileSync(new URL('../examples/data/todo.csv', import.meta.url), 'utf8')
    .trim()
    .split('\n');
const todo_rows = todo_lines.length - 1;
const url_id = await call('url_import_csv', 'POST', '/url-import', {
    token,
    body: { new_name: 'smoke_url_todo', url: `${RAW}/examples/data/todo.csv` }
});
let url_src = await url_source_settled('url_import_csv_source', url_id);
check('url_import_csv_ok', url_src?.last_status === 'OK', url_src);
check('url_import_csv_rows', url_src?.last_row_count === todo_rows, url_src);
const url_cols = await call(
    'url_import_csv_cols',
    'POST',
    `/web-file/data_grid_column/${url_id}?skip=0&limit=50`,
    { token, body: {} }
);
check(
    'url_import_csv_columns',
    (url_cols.data || []).map(c => c.headerName).join(',') === todo_lines[0].trim(),
    url_cols
);
// Through the external API like any other table
await call('url_import_ext_get', 'GET', '/api/v1/get?table=smoke_url_todo&skip=0&limit=1', {
    token: me.api_key
});

const tasks_template = JSON.parse(
    fs.readFileSync(
        new URL(
            '../packages/horizon-be/src/core/table-template/templates/tasks.json',
            import.meta.url
        ),
        'utf8'
    )
);
const json_id = await call('url_import_json', 'POST', '/url-import', {
    token,
    body: {
        new_name: 'smoke_url_tasks',
        url: `${RAW}/packages/horizon-be/src/core/table-template/templates/tasks.json`,
        mode: 'upsert',
        key_column: 'Task',
        schedule: 'daily'
    }
});
const json_src = await url_source_settled('url_import_json_source', json_id);
check('url_import_json_ok', json_src?.last_status === 'OK', json_src);
check('url_import_json_rows', json_src?.last_row_count === tasks_template.rows.length, json_src);
check(
    'url_import_json_scheduled',
    json_src?.schedule === 'daily' && json_src?.next_sync_at > Date.now(),
    json_src
);

// demo2 can't read, change or sync demo's source, nor import into demo's folder
await call('other_url_source', 'GET', `/url-import/${url_id}`, { token: otoken, expectFail: true });
await call('other_url_update', 'PUT', `/url-import/${url_id}`, {
    token: otoken,
    body: { url: 'https://example.com/other.csv' },
    expectFail: true
});
await call('other_url_sync', 'POST', `/url-import/${url_id}/sync`, {
    token: otoken,
    expectFail: true
});
await call('other_url_import_api_key', 'GET', `/url-import/${url_id}`, {
    token: other_me.api_key,
    expectFail: true
});
url_src = (await call('url_source_unchanged', 'GET', `/url-import/${url_id}`, { token }))?.source;
check(
    'other_url_update_changed_nothing',
    url_src?.url === `${RAW}/examples/data/todo.csv`,
    url_src
);
const no_source = await call('url_source_none', 'GET', `/url-import/${file_id}`, { token });
check('url_source_none_is_null', no_source?.source === null, no_source);
await call('url_sync_not_imported', 'POST', `/url-import/${file_id}/sync`, {
    token,
    expectFail: true
});

// Bad settings are a 400
await call('url_update_bad_mode', 'PUT', `/url-import/${url_id}`, {
    token,
    body: { mode: 'merge' },
    expectFail: true
});
await call('url_update_bad_schedule', 'PUT', `/url-import/${url_id}`, {
    token,
    body: { schedule: 'every-second' },
    expectFail: true
});
await call('url_update_private_url', 'PUT', `/url-import/${url_id}`, {
    token,
    body: { url: 'http://169.254.169.254/' },
    expectFail: true
});

// Upsert on "name": a deleted row comes back and an edited one is set back from the source
const url_rows = await call(
    'url_rows_before_upsert',
    'POST',
    `/web-file/data_grid_row/${url_id}?skip=0&limit=100`,
    { token, body: {} }
);
const name_field = (url_cols.data || []).find(c => c.headerName === 'name')?.field;
const priority_field = (url_cols.data || []).find(c => c.headerName === 'priority')?.field;
const [first_row, second_row] = url_rows.data || [];
if (first_row && second_row) {
    await call('url_edit_row', 'PUT', `/web-file/${first_row._id}/data_grid_row/${url_id}`, {
        token,
        body: { ...first_row, [priority_field]: 'smoke-edited' }
    });
    await call('url_delete_row', 'POST', `/web-file/batch_delete/data_grid_row/${url_id}`, {
        token,
        body: [second_row._id]
    });
}
await call('url_update_upsert', 'PUT', `/url-import/${url_id}`, {
    token,
    body: { mode: 'upsert', key_column: 'name' }
});
await call('url_sync_upsert', 'POST', `/url-import/${url_id}/sync`, { token });
url_src = await url_source_settled('url_sync_upsert_source', url_id);
check('url_sync_upsert_ok', url_src?.last_status === 'OK', url_src);
check('url_sync_upsert_rows', (await row_count('url_sync_upsert_count', url_id)) === todo_rows);
const upserted = await call(
    'url_rows_after_upsert',
    'POST',
    `/web-file/data_grid_row/${url_id}?skip=0&limit=100`,
    { token, body: {} }
);
const edited = (upserted.data || []).find(r => r[name_field] === first_row?.[name_field]);
check(
    'url_sync_upsert_restored_row',
    edited && edited._id === first_row._id && edited[priority_field] === first_row[priority_field],
    edited
);

// A link column on another table points at a row of the imported table; a replace gives every
// row a new id, so the link is cleared and the column still links to the table (#175)
const url_links = await call('url_links_create', 'POST', '/table-template/tasks', {
    token,
    body: { name: 'smoke_url_links' }
});
const url_link_col = await call(
    'url_links_new_column',
    'GET',
    `/web-file/${url_links}/get_new_column`,
    { token }
);
await call(
    'url_links_col_create',
    'PUT',
    `/web-file/${url_link_col?._id}/data_grid_column/${url_links}`,
    {
        token,
        body: {
            ...url_link_col,
            headerName: 'Todo',
            deleted: false,
            col_type: 'link',
            link_table_id: url_id,
            link_display_field: name_field
        }
    }
);
await sleep(500);
const ul_cols = await call(
    'url_links_cols',
    'POST',
    `/web-file/data_grid_column/${url_links}?skip=0&limit=50`,
    { token, body: {} }
);
const ulf = (ul_cols.data || []).find(c => c.headerName === 'Todo')?.field;
const ul_rows = await call(
    'url_links_rows',
    'POST',
    `/web-file/data_grid_row/${url_links}?skip=0&limit=50`,
    { token, body: {} }
);
const ul_row0 = ul_rows.data?.[0];
const ul_set = await call(
    'url_links_set',
    'PUT',
    `/web-file/${ul_row0?._id}/data_grid_row/${url_links}`,
    { token, body: { ...ul_row0, [ulf]: [edited?._id] } }
);
check(
    'url_links_set_ok',
    !!ulf && JSON.stringify(ul_set?.[ulf]) === JSON.stringify([edited?._id]),
    ul_set
);

// Replace: a row added by hand goes away
await call('url_add_row', 'POST', `/web-file/batch_create/data_grid_row/${url_id}`, {
    token,
    body: [{ [name_field]: 'smoke extra row' }]
});
check('url_added_row', (await row_count('url_added_row_count', url_id)) === todo_rows + 1);
await call('url_update_replace', 'PUT', `/url-import/${url_id}`, {
    token,
    body: { mode: 'replace' }
});
await call('url_sync_replace', 'POST', `/url-import/${url_id}/sync`, { token });
url_src = await url_source_settled('url_sync_replace_source', url_id);
check('url_sync_replace_ok', url_src?.last_status === 'OK', url_src);
check('url_sync_replace_rows', (await row_count('url_sync_replace_count', url_id)) === todo_rows);
const ul_after = await call(
    'url_links_after_replace',
    'GET',
    '/api/v1/get?table=smoke_url_links&skip=0&limit=50',
    { token: me.api_key }
);
check(
    'url_sync_replace_cleared_links',
    Array.isArray(ul_after?.data) &&
        ul_after.data.length > 0 &&
        ul_after.data.every(r => r.Todo === null || r.Todo === undefined),
    ul_after
);
const ul_cols_after = await call(
    'url_links_cols_after_replace',
    'POST',
    `/web-file/data_grid_column/${url_links}?skip=0&limit=50`,
    { token, body: {} }
);
check(
    'url_sync_replace_still_linked',
    (ul_cols_after.data || []).find(c => c.field === ulf)?.link_table_id === url_id,
    ul_cols_after
);
await call('url_links_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [url_links] }
});

// A sync that fails (no such key column in the source) is an error on the source, and the
// table keeps its rows and stays usable
await call('url_update_bad_key', 'PUT', `/url-import/${url_id}`, {
    token,
    body: { mode: 'upsert', key_column: 'no_such_column' }
});
await call('url_sync_bad_key', 'POST', `/url-import/${url_id}/sync`, { token });
url_src = await url_source_settled('url_sync_bad_key_source', url_id);
check(
    'url_sync_bad_key_error',
    url_src?.last_status === 'ERROR' && /no_such_column/.test(url_src?.last_error),
    url_src
);
check(
    'url_sync_bad_key_kept_rows',
    (await row_count('url_sync_bad_key_count', url_id)) === todo_rows
);
const after_bad = await call('url_list_after_bad_sync', 'GET', '/file-directory', { token });
const url_file = Array.isArray(after_bad) && after_bad.find(d => d.id === url_id);
check('url_sync_bad_key_table_usable', url_file && !url_file.status && !url_file.locked, url_file);

await call('url_import_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [url_id, json_id] }
});
await call('url_source_after_delete', 'GET', `/url-import/${url_id}`, { token, expectFail: true });

// Onboarding checklist (#143): each account sees only its own; the command has a placeholder for
// the key, never a key (#138), and runs with one put in; only a login session may read or change it.
const ONBOARDING_STEPS = ['create_table', 'view_api_key', 'copy_command', 'call_api'];
const step_done = (view, id) => !!view?.steps?.find?.(s => s.id === id)?.done;
const ob = await call('onboarding', 'GET', '/onboarding', { token });
check(
    'onboarding_steps',
    Array.isArray(ob?.steps) && ob.steps.map(s => s.id).join() === ONBOARDING_STEPS.join(),
    ob
);
check('onboarding_has_table', step_done(ob, 'create_table') && !!ob.first_call, ob);
const ob_cmd = ob?.first_call?.command || '';
const ob_placeholder = ob?.first_call?.key_placeholder || '';
check(
    'onboarding_command_has_key_placeholder',
    !!ob_placeholder &&
        ob_cmd.includes(`Bearer ${ob_placeholder}`) &&
        !ob_cmd.includes(me.api_key) &&
        !ob_cmd.includes(other_me.api_key),
    ob_cmd
);
// Run the command with the key in (as the app does), pointed at this backend (as snippet() does
// for the docs)
let ob_out;
try {
    const pub_base = ob.first_call.url.slice(0, ob.first_call.url.indexOf('/api/v1/'));
    const with_key = ob_cmd.split(ob_placeholder).join(me.api_key);
    ob_out = execFileSync('bash', ['-c', with_key.split(pub_base).join(BASE)], {
        encoding: 'utf8',
        timeout: 30000
    });
} catch (ex) {
    ob_out = `error: ${ex.stderr || ex.message}`;
}
results.onboarding_command_out = ob_out;
let ob_res;
try {
    ob_res = JSON.parse(ob_out);
} catch {
    ob_res = null;
}
check(
    'onboarding_command_runs',
    Array.isArray(ob_res?.data) && typeof ob_res.count === 'number',
    ob_out
);
// The call is recorded just after it's answered
let ob_called;
for (let i = 0; i < 10; i++) {
    ob_called = await call('onboarding_after_call', 'GET', '/onboarding', { token });
    if (step_done(ob_called, 'call_api')) break;
    await sleep(200);
}
check(
    'onboarding_call_ticked',
    ONBOARDING_STEPS.slice(1).every(id => step_done(ob_called, id)),
    ob_called
);
const ob_marked = await call('onboarding_mark_key', 'PUT', '/onboarding/steps/view_api_key', {
    token
});
check('onboarding_mark_key_done', step_done(ob_marked, 'view_api_key'), ob_marked);
await call('onboarding_mark_call_api', 'PUT', '/onboarding/steps/call_api', {
    token,
    expectFail: true
});
await call('onboarding_mark_unknown', 'PUT', '/onboarding/steps/dismissed_at', {
    token,
    expectFail: true
});
await call('onboarding_unauth', 'GET', '/onboarding', { expectFail: true });
await call('onboarding_api_key', 'GET', '/onboarding', { token: me.api_key, expectFail: true });
await call('onboarding_api_key_dismiss', 'PUT', '/onboarding/dismiss', {
    token: me.api_key,
    expectFail: true
});
await call('onboarding_unauth_mark', 'PUT', '/onboarding/steps/copy_command', {
    expectFail: true
});
const ob_other = await call('other_onboarding', 'GET', '/onboarding', { token: otoken });
const ob_other_cmd = ob_other?.first_call?.command || '';
check(
    'other_onboarding_is_own',
    !ob_other_cmd.includes(me.api_key) && !ob_other_cmd.includes(other_me.api_key),
    ob_other
);
// Dismissed, it stays hidden, and demo's checklist doesn't change. demo2 dismisses, so the UI
// smoke test (which signs in as demo) still sees demo's checklist on the same stack.
const ob_before = await call('onboarding_before_other_dismiss', 'GET', '/onboarding', { token });
const ob_dismissed = await call('other_onboarding_dismiss', 'PUT', '/onboarding/dismiss', {
    token: otoken
});
check('other_onboarding_dismissed', ob_dismissed?.show === false, ob_dismissed);
const ob_again = await call('other_onboarding_after_dismiss', 'GET', '/onboarding', {
    token: otoken
});
check('other_onboarding_stays_dismissed', ob_again?.show === false, ob_again);
const ob_after = await call('onboarding_after_other_dismiss', 'GET', '/onboarding', { token });
check(
    'onboarding_not_dismissed_by_other',
    ob_after?.show === ob_before?.show &&
        ONBOARDING_STEPS.every(id => step_done(ob_after, id) === step_done(ob_before, id)),
    ob_after
);

await call('other_logout', 'GET', `/auth/logout?token=${otoken}`);
const me_after = await call('authorize_after_other', 'GET', `/auth/authorize?token=${token}`);
check('own_account_unchanged', me_after.first_name === me.first_name, me_after);

// External API with the account API key
const key = me.api_key;
await call('ext_get', 'GET', `/api/v1/get?table=smoke_people&skip=0&limit=10`, { token: key });
await call('ext_search', 'POST', `/api/v1/search?table=smoke_people&skip=0&limit=10`, {
    token: key,
    body: { name: { type: 'equals', value: 'bob' } }
});

// Richer queries (#141): POST /api/v1/query and /count. The table now has alice2 (30), bob (41),
// carol (25) and dave (50); age is an indexed number column.
const QUERY = '/api/v1/query?table=smoke_people';
const COUNT = '/api/v1/count?table=smoke_people';
const query = (name, body, opts = {}) => call(name, 'POST', QUERY, { token: key, body, ...opts });
const names = res => (res.data || []).map(r => r.name);
const q_older = await query('ext_query_filters_sort_fields', {
    filters: [{ column: 'age', op: 'gte', value: 30 }],
    sort: ['-age'],
    fields: ['name']
});
check(
    'ext_query_filters_sort_fields_result',
    JSON.stringify(names(q_older)) === JSON.stringify(['dave', 'bob', 'alice2']) &&
        q_older.data.every(r => JSON.stringify(Object.keys(r)) === '["_id","name"]') &&
        q_older.next_cursor === null,
    q_older
);
const q_any = await query('ext_query_match_any', {
    filters: [
        { column: 'name', op: 'eq', value: 'bob' },
        { column: 'age', op: 'lt', value: 26 },
        { column: 'name', op: 'in', value: ['nobody'] }
    ],
    match: 'any',
    sort: [{ column: 'name', dir: 'asc' }]
});
check(
    'ext_query_match_any_result',
    JSON.stringify(names(q_any)) === JSON.stringify(['bob', 'carol']),
    q_any
);
const q_ops = await query('ext_query_contains_empty_ne', {
    filters: [
        { column: 'name', op: 'contains', value: 'A' },
        { column: 'name', op: 'ne', value: 'carol' },
        { column: 'name', op: 'empty', value: false }
    ],
    sort: ['name']
});
check(
    'ext_query_contains_empty_ne_result',
    JSON.stringify(names(q_ops)) === JSON.stringify(['alice2', 'dave']),
    q_ops
);

// Cursor paging, one row a page, with rows added after the first page: the one sorting before
// the cursor isn't returned, the one after it is, and no row comes twice
const paged = { sort: ['age'], fields: ['name', 'age'], limit: 1 };
let page = await query('ext_query_page_1', paged);
const seen = names(page);
await call('ext_query_page_insert', 'POST', '/api/v1/create?table=smoke_people', {
    token: key,
    body: [
        { name: 'smoke_early', age: 1 },
        { name: 'smoke_late', age: 99 }
    ]
});
for (let i = 2; page.next_cursor && i <= 10; i++) {
    page = await query(`ext_query_page_${i}`, { ...paged, cursor: page.next_cursor });
    seen.push(...names(page));
}
check(
    'ext_query_cursor_paging',
    JSON.stringify(seen) === JSON.stringify(['carol', 'alice2', 'bob', 'dave', 'smoke_late']),
    seen
);
const first_page = await query('ext_query_cursor_first', paged);
await query(
    'ext_query_cursor_wrong_query',
    { ...paged, sort: ['-age'], cursor: first_page.next_cursor },
    { expectFail: true }
);
const added = await query('ext_query_added_rows', {
    filters: [{ column: 'name', op: 'in', value: ['smoke_early', 'smoke_late'] }]
});
if ((added.data || []).length > 0) {
    await call('ext_query_added_rows_delete', 'POST', '/api/v1/delete?table=smoke_people', {
        token: key,
        body: added.data.map(r => r._id)
    });
}

// Count
const total_rows = await call(
    'ext_get_total',
    'GET',
    '/api/v1/get?table=smoke_people&skip=0&limit=1',
    {
        token: key
    }
);
const count_all = await call('ext_count_all', 'POST', COUNT, { token: key, body: {} });
const count_old = await call('ext_count_filtered', 'POST', COUNT, {
    token: key,
    body: { filters: [{ column: 'age', op: 'gt', value: 40 }] }
});
check(
    'ext_count_result',
    count_all.count === total_rows.count && total_rows.count === 4 && count_old.count === 2,
    { count_all, count_old, total_rows }
);

// An equality filter on the indexed age column uses its index
const explained = await query('ext_query_explain', {
    filters: [{ column: 'age', op: 'eq', value: 41 }],
    explain: true
});
check(
    'ext_query_uses_index',
    explained.explain?.uses_index === true && explained.explain.index_columns.includes('age'),
    explained
);

// Bad column names, operators and values are a clear 400, never a Mongo error
const bad_queries = {
    unknown_column: { filters: [{ column: 'nope', op: 'eq', value: 1 }] },
    unknown_op: { filters: [{ column: 'age', op: '$where', value: 'sleep(1000)' }] },
    operator_as_value: { filters: [{ column: 'name', op: 'eq', value: { $ne: null } }] },
    wrong_type: { filters: [{ column: 'age', op: 'gt', value: 'ten' }] },
    contains_on_number: { filters: [{ column: 'age', op: 'contains', value: '1' }] },
    bad_sort: { sort: ['nope'] },
    bad_field: { fields: ['nope'] },
    bad_cursor: { cursor: 'eyJub3QiOiJhIGN1cnNvciJ9' },
    over_limit: { limit: 100000 },
    unknown_key: { where: {} },
    not_an_object: [1]
};
for (const [name, body] of Object.entries(bad_queries)) {
    await query(`ext_query_bad_${name}`, body, { expectFail: true });
    check(
        `ext_query_bad_${name}_is_400`,
        results[`ext_query_bad_${name}`].status === 400 &&
            typeof results[`ext_query_bad_${name}`].data?.message === 'string',
        results[`ext_query_bad_${name}`]
    );
}
await call('ext_count_bad', 'POST', COUNT, {
    token: key,
    body: { filters: [{ column: 'age', op: 'eq', value: [1] }] },
    expectFail: true
});
await call('ext_query_no_table', 'POST', '/api/v1/query', {
    token: key,
    body: {},
    expectFail: true
});
check(
    'ext_query_no_table_is_400',
    results.ext_query_no_table.status === 400,
    results.ext_query_no_table
);
// No table, or table given twice (Express makes it an array): a 400 with a message, not a 500 (#165)
for (const [name, query] of [
    ['ext_get_no_table', '?skip=0&limit=1'],
    ['ext_get_two_tables', '?table=smoke_people&table=smoke_people&skip=0&limit=1']
]) {
    await call(name, 'GET', `/api/v1/get${query}`, { token: key, expectFail: true });
    check(
        `${name}_is_400`,
        results[name].status === 400 && /'table'/.test(results[name].data?.message ?? ''),
        results[name]
    );
}

const created = await call('ext_create', 'POST', `/api/v1/create?table=smoke_people`, {
    token: key,
    body: [{ name: 'erin', age: 22 }]
});
const ext_rows = await call('ext_get2', 'GET', `/api/v1/get?table=smoke_people&skip=0&limit=10`, {
    token: key
});
const erin = Array.isArray(ext_rows)
    ? ext_rows.find(r => r.name === 'erin')
    : (ext_rows.data || []).find(r => r.name === 'erin');
if (erin) {
    await call('ext_update', 'PUT', `/api/v1/update?table=smoke_people`, {
        token: key,
        body: [{ ...erin, age: 23 }]
    });
    await call('ext_delete', 'POST', `/api/v1/delete?table=smoke_people`, {
        token: key,
        body: [erin._id]
    });
}
await call('ext_bad_key', 'GET', `/api/v1/get?table=smoke_people&skip=0&limit=1`, {
    token: 'not-a-key',
    expectFail: true
});

// Audit log (#217): the table's changes above, newest first, from the app (demo's email) and
// /api/v1 (the "smoke" key's name and prefix, never the key); the account's log has the key
// made at the start; paging; demo2 and API keys can't read demo's log.
const audit = await call('audit_table', 'GET', `/audit?table=${file_id}&limit=100`, { token });
const audit_entries = Array.isArray(audit?.entries) ? audit.entries : [];
const audit_has = (action, actor_type, extra = () => true) =>
    audit_entries.some(e => e.action === action && e.actor?.type === actor_type && extra(e));
check('audit_table_created', audit_has('table.created', 'user'), audit_entries.slice(-3));
check(
    'audit_app_row_changes',
    audit_has('row.updated', 'user', e => e.actor.label === 'demo@invokedb.com') &&
        audit_has('row.created', 'user', e => e.details?.count === 1),
    audit_entries
);
check(
    'audit_column_type_change',
    audit_has('column.updated', 'user', e =>
        (e.details?.changes || []).some(c => /number/.test(c))
    ),
    audit_entries.filter(e => e.action.startsWith('column.'))
);
const smoke_key_label = e =>
    e.source === 'api' && e.actor.key_prefix === key?.slice(0, 6) && /smoke/.test(e.actor.label);
check(
    'audit_api_row_changes',
    ['row.created', 'row.updated', 'row.deleted'].every(a =>
        audit_has(a, 'api_key', smoke_key_label)
    ),
    audit_entries.filter(e => e.source === 'api').slice(0, 5)
);
check(
    'audit_newest_first',
    audit_entries.length > 3 &&
        audit_entries.every((e, i) => i === 0 || audit_entries[i - 1].created_at >= e.created_at),
    audit_entries.map(e => e.created_at)
);
check(
    'audit_no_secrets',
    !!key && !JSON.stringify(audit).includes(key) && audit_entries.every(e => !('account_id' in e)),
    audit_entries[0]
);
check(
    'audit_only_this_table',
    audit_entries.every(e => e.file_id === file_id),
    audit_entries[0]
);
const audit_p1 = await call('audit_page_1', 'GET', `/audit?table=${file_id}&limit=2`, { token });
const audit_p2 = await call(
    'audit_page_2',
    'GET',
    `/audit?table=${file_id}&limit=2&cursor=${encodeURIComponent(audit_p1?.next_cursor || '')}`,
    { token }
);
check(
    'audit_paged',
    audit_p1?.entries?.length === 2 &&
        !!audit_p1.next_cursor &&
        audit_p2?.entries?.length === 2 &&
        audit_p2.entries.every(e => !audit_p1.entries.some(f => f.id === e.id)) &&
        audit_p2.entries[0].id === audit_entries[2]?.id,
    { p1: audit_p1, p2: audit_p2 }
);
await call('audit_bad_limit', 'GET', `/audit?table=${file_id}&limit=1000`, {
    token,
    expectFail: true
});
await call('audit_bad_cursor', 'GET', `/audit?cursor=nope`, { token, expectFail: true });
const audit_account = await call('audit_account', 'GET', '/audit?limit=100', { token });
check(
    'audit_account_has_key_created',
    (audit_account?.entries || []).some(
        e => e.action === 'api_key.created' && e.file_id === null && e.details?.key_name === 'smoke'
    ) && audit_account?.keep_days === 90,
    (audit_account?.entries || []).slice(0, 3)
);
// demo2 (logged in again: its first session ended above) sees none of demo's entries
const audit_other = await call('audit_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const audit_otoken = audit_other.token;
await call('other_audit_table', 'GET', `/audit?table=${file_id}`, {
    token: audit_otoken,
    expectFail: true
});
check('other_audit_table_is_404', results.other_audit_table?.status === 404);
const other_audit = await call('other_audit_account', 'GET', '/audit?limit=100', {
    token: audit_otoken
});
check(
    'other_audit_account_is_own',
    Array.isArray(other_audit?.entries) && other_audit.entries.every(e => e.file_id !== file_id),
    other_audit?.entries?.slice(0, 3)
);
await call('audit_other_logout', 'GET', `/auth/logout?token=${audit_otoken}`);
await call('audit_api_key', 'GET', '/audit', { token: key, expectFail: true });

// Per-table API docs (#139): the docs and OpenAPI spec, then run the generated curl, fetch
// and (if python3 is installed) Python snippets against this backend
const docs = await call('api_docs', 'GET', `/web-file/${file_id}/api-docs`, { token });
const doc_ids = (docs.endpoints || []).map(e => e.id).join(',');
check('api_docs_endpoints', doc_ids === 'get,search,query,count,create,update,delete', docs);
check(
    'api_docs_columns',
    docs.table === 'smoke_people' &&
        JSON.stringify((docs.columns || []).map(c => c.name).sort()) ===
            JSON.stringify((cols.data || []).map(c => c.headerName).sort()) &&
        docs.columns.find(c => c.name === 'age')?.type === 'number',
    docs
);
const spec = await call('openapi', 'GET', `/web-file/${file_id}/openapi.json`, { token });
const ext_spec = await call('ext_openapi', 'GET', '/api/v1/openapi?table=smoke_people', {
    token: key
});
check(
    'openapi_spec',
    spec.openapi === '3.0.3' &&
        JSON.stringify(spec) === JSON.stringify(ext_spec) &&
        Object.keys(spec.paths || {}).length === 7 &&
        'age' in (spec.components?.schemas?.Row?.properties || {}),
    spec
);

// Snippets point at the public API URL; run them against this backend instead
function snippet(id, lang, row_id) {
    const e = (docs.endpoints || []).find(x => x.id === id);
    let code = e ? e.snippets[lang] : '';
    code = code.split(docs.base_url).join(`${BASE}/api/v1`);
    if (row_id) code = code.split(docs.row_id_placeholder).join(row_id);
    return code;
}
const RUNNERS = {
    curl: ['bash', ['-s']],
    fetch: [process.execPath, ['--input-type=module']],
    python: ['python3', ['-']]
};
function run_snippet(name, lang, code, ok) {
    let out;
    try {
        const [cmd, args] = RUNNERS[lang];
        out = execFileSync(cmd, args, {
            input: code,
            encoding: 'utf8',
            timeout: 30000,
            env: { ...process.env, [docs.api_key_env || 'INVOKEDB_API_KEY']: key }
        }).trim();
    } catch (ex) {
        out = `error: ${ex.stderr || ex.message}`;
    }
    results[name] = out;
    check(name, !!code && ok(out), { code, out });
    return out;
}
const json_after = (out, prefix = '') => {
    try {
        return JSON.parse(out.slice(prefix.length));
    } catch {
        return null;
    }
};
const ext_count = async name =>
    (await call(name, 'GET', '/api/v1/get?table=smoke_people&skip=0&limit=100', { token: key }))
        .data || [];

const before_snippets = await ext_count('snippet_rows_before');
run_snippet('snippet_get_curl', 'curl', snippet('get', 'curl'), out => {
    const res = json_after(out);
    return res?.count === before_snippets.length && Array.isArray(res.data);
});
run_snippet('snippet_search_fetch', 'fetch', snippet('search', 'fetch'), out => {
    const res = json_after(out, '201 ');
    return out.startsWith('201 ') && res?.count >= 1;
});
run_snippet('snippet_query_curl', 'curl', snippet('query', 'curl'), out => {
    const res = json_after(out);
    return Array.isArray(res?.data) && 'next_cursor' in res;
});
run_snippet('snippet_count_fetch', 'fetch', snippet('count', 'fetch'), out => {
    const res = json_after(out, '200 ');
    return out.startsWith('200 ') && typeof res?.count === 'number';
});
// create answers 201 with no body (curl prints only the body; an error would be JSON)
run_snippet(
    'snippet_create_curl',
    'curl',
    snippet('create', 'curl'),
    out => !out.startsWith('error') && !out.includes('"status"')
);
const after_create = await ext_count('snippet_rows_after_create');
const new_row = after_create.find(r => !before_snippets.some(b => b._id === r._id));
check('snippet_create_added_row', after_create.length === before_snippets.length + 1 && !!new_row);
if (new_row) {
    run_snippet(
        'snippet_update_fetch',
        'fetch',
        snippet('update', 'fetch', new_row._id),
        out => out === '200 1'
    );
    run_snippet(
        'snippet_delete_curl',
        'curl',
        snippet('delete', 'curl', new_row._id),
        out => out === '1'
    );
}
const after_delete = await ext_count('snippet_rows_after_delete');
check('snippet_delete_removed_row', after_delete.length === before_snippets.length);
let has_python = false;
try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    has_python = true;
} catch {
    console.log('skip --- python3 not installed: Python snippets not run');
}
if (has_python) {
    run_snippet('snippet_get_python', 'python', snippet('get', 'python'), out => {
        const res = json_after(out, '200 ');
        return out.startsWith('200 ') && res?.count === before_snippets.length;
    });
    run_snippet('snippet_search_python', 'python', snippet('search', 'python'), out =>
        out.startsWith('201 ')
    );
    run_snippet('snippet_query_python', 'python', snippet('query', 'python'), out =>
        out.startsWith('200 ')
    );
}

// Webhooks on row changes (#140). A receiver on 127.0.0.1:8199 (smoke-env.sh's
// HORIZON_WEBHOOK_TEST_HOSTS lets the backend call it, and nothing else on a private address)
// checks every delivery's signature and timestamp. Private and loopback URLs are a 400; row
// changes through the app and /api/v1 are delivered; a failed attempt is retried and logged;
// a disabled webhook sends nothing; demo2 can't see, use or change demo's webhooks.
const HOOK_HOST = '127.0.0.1:8199';
const hook_received = [];
let hook_fail_next = 0;
const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
        hook_received.push({ path: req.url, headers: req.headers, body, at: Date.now() });
        if (hook_fail_next > 0) {
            hook_fail_next--;
            res.statusCode = 500;
            res.end('try again');
            return;
        }
        res.end('ok');
    });
});
const receiver_up = await new Promise(resolve => {
    receiver.once('error', err => resolve(err));
    receiver.listen(8199, '127.0.0.1', () => resolve(true));
});
check('webhook_receiver_listening', receiver_up === true, String(receiver_up));

// What a receiver does: HMAC-SHA256 of "<t>.<body>", and refuse a timestamp over 5 minutes off
function verify_hook(secret, body, header, now_sec = Math.floor(Date.now() / 1000)) {
    const parts = Object.fromEntries(
        String(header || '')
            .split(',')
            .map(p => p.split('='))
    );
    const t = Number(parts.t);
    if (!Number.isInteger(t) || Math.abs(now_sec - t) > 300 || !parts.v1) return false;
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const given = Buffer.from(parts.v1, 'hex');
    return given.length === 32 && crypto.timingSafeEqual(given, Buffer.from(expected, 'hex'));
}

// Waits for a delivery to `path` that matches; answers it with its parsed payload
async function hook_delivery(name, path, match, timeout_ms = 20000) {
    const deadline = Date.now() + timeout_ms;
    for (;;) {
        const found = hook_received.find(d => {
            if (d.path !== path) return false;
            try {
                return match(JSON.parse(d.body), d);
            } catch {
                return false;
            }
        });
        if (found || Date.now() > deadline) {
            check(
                name,
                !!found,
                hook_received.map(d => d.path + ' ' + d.body.slice(0, 80))
            );
            return found ? { ...found, payload: JSON.parse(found.body) } : null;
        }
        await sleep(250);
    }
}

const hooks_before = await call('webhook_list_before', 'GET', '/webhook', { token });
const hook_count_before = hooks_before?.webhooks?.length;
const refused_hook_urls = {
    loopback: 'http://127.0.0.1/hook',
    loopback_other_port: 'http://127.0.0.1:8198/hook',
    localhost: `http://localhost:8199/hook`,
    private_10: 'http://10.0.0.1/hook',
    private_192: 'http://192.168.0.10/hook',
    metadata: 'http://169.254.169.254/latest/meta-data',
    ipv6_loopback: 'http://[::1]/hook',
    internal_name: 'https://db.internal/hook',
    not_http: 'ftp://example.com/hook'
};
for (const [name, url] of Object.entries(refused_hook_urls)) {
    await call(`webhook_refused_${name}`, 'POST', '/webhook', {
        token,
        body: { url, events: ['row.created'], file_id },
        expectFail: true
    });
    check(
        `webhook_refused_${name}_is_400`,
        results[`webhook_refused_${name}`].status === 400,
        results[`webhook_refused_${name}`]
    );
}
await call('webhook_bad_events', 'POST', '/webhook', {
    token,
    body: { url: `http://${HOOK_HOST}/a`, events: ['row.exploded'], file_id },
    expectFail: true
});
await call('webhook_no_events', 'POST', '/webhook', {
    token,
    body: { url: `http://${HOOK_HOST}/a`, events: [], file_id },
    expectFail: true
});
const hooks_after_refused = await call('webhook_list_after_refused', 'GET', '/webhook', { token });
check(
    'webhook_refused_made_nothing',
    typeof hook_count_before === 'number' &&
        hooks_after_refused?.webhooks?.length === hook_count_before,
    hooks_after_refused
);

// Hook A: this table, every event. Hook B: every table, deletes only.
const hook_a = await call('webhook_create_table', 'POST', '/webhook', {
    token,
    body: {
        url: `http://${HOOK_HOST}/a`,
        events: ['row.created', 'row.updated', 'row.deleted'],
        file_id
    }
});
const hook_b = await call('webhook_create_all_tables', 'POST', '/webhook', {
    token,
    body: { url: `http://${HOOK_HOST}/b`, events: ['row.deleted'], file_id: null }
});
check(
    'webhook_created',
    hook_a?.file_id === file_id &&
        hook_a?.enabled === true &&
        /^whsec_/.test(hook_a?.secret || '') &&
        hook_b?.file_id === null &&
        hook_a?.secret !== hook_b?.secret,
    { hook_a, hook_b }
);
const table_hooks = await call('webhook_list_table', 'GET', `/webhook?table=${file_id}`, {
    token
});
check(
    'webhook_list_table_has_both',
    [hook_a?.id, hook_b?.id].every(id => table_hooks?.webhooks?.some(h => h.id === id)),
    table_hooks
);

// "Send test event"
await call('webhook_test', 'POST', `/webhook/${hook_a?.id}/test`, { token });
const ping = await hook_delivery('webhook_test_delivered', '/a', p => p.event === 'ping');
check(
    'webhook_test_signed',
    !!ping &&
        verify_hook(hook_a.secret, ping.body, ping.headers['invokedb-signature']) &&
        ping.headers['invokedb-event'] === 'ping' &&
        ping.headers['invokedb-delivery'] === ping.payload.id &&
        ping.payload.table?.id === file_id,
    ping && { headers: ping.headers, payload: ping.payload }
);
// The receiver's check isn't a rubber stamp: another body, secret or an old timestamp fail
check(
    'webhook_signature_check_rejects_tampering',
    !!ping &&
        !verify_hook(hook_a.secret, ping.body + ' ', ping.headers['invokedb-signature']) &&
        !verify_hook(hook_b.secret, ping.body, ping.headers['invokedb-signature']) &&
        !verify_hook(
            hook_a.secret,
            ping.body,
            ping.headers['invokedb-signature'],
            Math.floor(Date.now() / 1000) + 600
        )
);

// Changes through the app (session routes)
await call('webhook_ui_create', 'POST', `/web-file/batch_create/data_grid_row/${file_id}`, {
    token,
    body: [{ a: 'hook_ui', b: 61 }]
});
const ui_created = await hook_delivery(
    'webhook_ui_created_delivered',
    '/a',
    p => p.event === 'row.created' && p.rows?.[0]?.name === 'hook_ui'
);
const ui_row_id = ui_created?.payload.rows[0]._id;
check(
    'webhook_ui_created_payload',
    ui_created?.payload.rows[0].age === 61 && ui_created?.payload.table?.name === 'smoke_people',
    ui_created?.payload
);
await call('webhook_ui_batch_update', 'PUT', `/web-file/batch_update/data_grid_row/${file_id}`, {
    token,
    body: [{ _id: ui_row_id, b: 62 }]
});
await hook_delivery(
    'webhook_ui_batch_updated_delivered',
    '/a',
    p => p.event === 'row.updated' && p.rows?.[0]?._id === ui_row_id && p.rows[0].age === 62
);
await call('webhook_ui_update', 'PUT', `/web-file/${ui_row_id}/data_grid_row/${file_id}`, {
    token,
    body: { _id: ui_row_id, b: 63 }
});
await hook_delivery(
    'webhook_ui_updated_delivered',
    '/a',
    p => p.event === 'row.updated' && p.rows?.[0]?._id === ui_row_id && p.rows[0].age === 63
);
await call('webhook_ui_delete', 'POST', `/web-file/batch_delete/data_grid_row/${file_id}`, {
    token,
    body: [ui_row_id]
});
for (const path of ['/a', '/b']) {
    await hook_delivery(
        `webhook_ui_deleted_delivered${path.replace('/', '_')}`,
        path,
        p => p.event === 'row.deleted' && p.rows?.some(r => r._id === ui_row_id)
    );
}

// Changes through /api/v1
await call('webhook_ext_create', 'POST', '/api/v1/create?table=smoke_people', {
    token: key,
    body: [{ name: 'hook_api', age: 71 }]
});
const api_created = await hook_delivery(
    'webhook_ext_created_delivered',
    '/a',
    p => p.event === 'row.created' && p.rows?.[0]?.name === 'hook_api'
);
const api_row_id = api_created?.payload.rows[0]._id;
await call('webhook_ext_update', 'PUT', '/api/v1/update?table=smoke_people', {
    token: key,
    body: [{ _id: api_row_id, age: 72 }]
});
await hook_delivery(
    'webhook_ext_updated_delivered',
    '/a',
    p => p.event === 'row.updated' && p.rows?.[0]?._id === api_row_id && p.rows[0].age === 72
);
await call('webhook_ext_delete', 'POST', '/api/v1/delete?table=smoke_people', {
    token: key,
    body: [api_row_id]
});
for (const path of ['/a', '/b']) {
    await hook_delivery(
        `webhook_ext_deleted_delivered${path.replace('/', '_')}`,
        path,
        p => p.event === 'row.deleted' && p.rows?.some(r => r._id === api_row_id)
    );
}
// B only wants deletes
check(
    'webhook_events_filtered',
    hook_received
        .filter(d => d.path === '/b')
        .every(d => JSON.parse(d.body).event === 'row.deleted')
);
// Every delivery carries a valid signature from its own webhook's secret
const secret_of = { '/a': hook_a?.secret, '/b': hook_b?.secret };
check(
    'webhook_all_deliveries_signed',
    hook_received.length > 0 &&
        hook_received.every(d =>
            verify_hook(secret_of[d.path], d.body, d.headers['invokedb-signature'])
        ),
    hook_received.length
);

// A failed attempt (HTTP 500) is retried, and both attempts are in the delivery log
hook_fail_next = 1;
const retried = await call('webhook_test_retry', 'POST', `/webhook/${hook_a?.id}/test`, { token });
await hook_delivery(
    'webhook_retry_delivered',
    '/a',
    (p, d) =>
        p.id === retried?.id &&
        hook_received.filter(x => x.path === '/a' && x.body === d.body).length >= 2,
    40000
);
let retry_log;
for (let i = 0; i < 20; i++) {
    const log = await call('webhook_deliveries', 'GET', `/webhook/${hook_a?.id}/deliveries`, {
        token
    });
    retry_log = (log?.deliveries || []).find(d => d.id === retried?.id);
    if (retry_log?.status === 'ok') break;
    await sleep(500);
}
check(
    'webhook_retry_logged',
    retry_log?.status === 'ok' &&
        retry_log.attempts === 2 &&
        retry_log.attempt_log?.[0]?.status === 500 &&
        retry_log.attempt_log?.[1]?.status === 200 &&
        retry_log.payload?.id === retried?.id,
    retry_log
);

// Disabled, it sends nothing
await call('webhook_disable', 'PUT', `/webhook/${hook_a?.id}`, {
    token,
    body: { enabled: false }
});
const sent_before_off = hook_received.filter(d => d.path === '/a').length;
await call('webhook_off_create', 'POST', '/api/v1/create?table=smoke_people', {
    token: key,
    body: [{ name: 'hook_off', age: 1 }]
});
await sleep(5000);
check(
    'webhook_disabled_sends_nothing',
    hook_received.filter(d => d.path === '/a').length === sent_before_off
);
const off_rows = await call('webhook_off_rows', 'POST', '/api/v1/query?table=smoke_people', {
    token: key,
    body: { filters: [{ column: 'name', op: 'eq', value: 'hook_off' }], fields: ['name'] }
});
const off_ids = (off_rows?.data || []).map(r => r._id);
if (off_ids.length) {
    await call('webhook_off_cleanup', 'POST', '/api/v1/delete?table=smoke_people', {
        token: key,
        body: off_ids
    });
}

// demo2 can't see, use or change demo's webhooks, nor hook demo's table; an API key can't
// manage webhooks
const other2 = await call('webhook_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const otoken2 = other2.token;
const other_hooks = await call('webhook_other_list', 'GET', '/webhook', { token: otoken2 });
check(
    'webhook_other_list_is_own',
    Array.isArray(other_hooks?.webhooks) &&
        !other_hooks.webhooks.some(h => h.id === hook_a?.id || h.id === hook_b?.id),
    other_hooks
);
await call('webhook_other_list_table', 'GET', `/webhook?table=${file_id}`, {
    token: otoken2,
    expectFail: true
});
await call('webhook_other_create_on_table', 'POST', '/webhook', {
    token: otoken2,
    body: { url: `http://${HOOK_HOST}/x`, events: ['row.created'], file_id },
    expectFail: true
});
await call('webhook_other_update', 'PUT', `/webhook/${hook_a?.id}`, {
    token: otoken2,
    body: { enabled: true, url: `http://${HOOK_HOST}/stolen` },
    expectFail: true
});
await call('webhook_other_test', 'POST', `/webhook/${hook_a?.id}/test`, {
    token: otoken2,
    expectFail: true
});
await call('webhook_other_deliveries', 'GET', `/webhook/${hook_a?.id}/deliveries`, {
    token: otoken2,
    expectFail: true
});
await call('webhook_other_delete', 'DELETE', `/webhook/${hook_a?.id}`, {
    token: otoken2,
    expectFail: true
});
await call('webhook_api_key_list', 'GET', '/webhook', { token: key, expectFail: true });
await call('webhook_api_key_create', 'POST', '/webhook', {
    token: key,
    body: { url: `http://${HOOK_HOST}/x`, events: ['row.created'], file_id },
    expectFail: true
});
const hooks_after_other = await call('webhook_list_after_other', 'GET', '/webhook', { token });
const a_after = hooks_after_other?.webhooks?.find(h => h.id === hook_a?.id);
check(
    'webhook_other_changed_nothing',
    a_after?.enabled === false && a_after?.url === `http://${HOOK_HOST}/a`,
    a_after
);
check(
    'webhook_other_never_delivered',
    !hook_received.some(d => d.path === '/x' || d.path === '/stolen')
);
await call('webhook_other_logout', 'GET', `/auth/logout?token=${otoken2}`);

// Deleted, they're gone with their log
await call('webhook_delete_a', 'DELETE', `/webhook/${hook_a?.id}`, { token });
await call('webhook_delete_b', 'DELETE', `/webhook/${hook_b?.id}`, { token });
await call('webhook_delete_again', 'DELETE', `/webhook/${hook_a?.id}`, {
    token,
    expectFail: true
});
await call('webhook_deliveries_after_delete', 'GET', `/webhook/${hook_a?.id}/deliveries`, {
    token,
    expectFail: true
});
const hooks_after_delete = await call('webhook_list_after_delete', 'GET', '/webhook', { token });
check(
    'webhook_deleted',
    hooks_after_delete?.webhooks?.length === hook_count_before &&
        !hooks_after_delete.webhooks.some(h => h.id === hook_a?.id || h.id === hook_b?.id),
    hooks_after_delete
);
receiver.closeAllConnections();
receiver.close();

// Shareable forms (#145), on a table made from the waitlist template. The public link shows the
// questions with their column types; a submission is checked against them and becomes a row; a
// filled honeypot adds nothing; a closed, deleted or table-deleted form's link stops working;
// submissions are rate-limited per IP; demo2 can't see, change or delete demo's forms, nor put
// one on demo's table; an API key can't manage forms.
const form_table = await call('form_table_create', 'POST', '/table-template/waitlist', {
    token,
    body: { name: 'smoke_form_waitlist' }
});
const form_cols = await call(
    'form_table_cols',
    'POST',
    `/web-file/data_grid_column/${form_table}?skip=0&limit=50`,
    { token, body: {} }
);
const form_col = name => (form_cols.data || []).find(c => c.headerName === name)?.field;
const [f_email, f_name, f_position, f_joined, f_status] = [
    'Email',
    'Name',
    'Position',
    'Joined',
    'Status'
].map(form_col);
check('form_table_columns', !!(f_email && f_name && f_position && f_joined && f_status), form_cols);
const form_rows = async name =>
    (
        await call(name, 'POST', `/web-file/data_grid_row/${form_table}?skip=0&limit=100`, {
            token,
            body: {}
        })
    )?.data || [];
const form_rows_before = await form_rows('form_rows_before');

const form_body = {
    file_id: form_table,
    title: 'Join the smoke waitlist',
    description: 'A form from api-smoke.mjs',
    fields: [
        { field: f_email, required: true, label: 'Your email' },
        { field: f_name },
        { field: f_position, help: 'Any number' },
        { field: f_joined }
    ],
    thank_you: 'Thanks, smoke!',
    redirect_url: 'https://example.com/thanks'
};
const bad_forms = {
    form_create_no_fields: { ...form_body, fields: [] },
    form_create_unknown_column: { ...form_body, fields: [{ field: 'zz' }] },
    form_create_repeated_column: { ...form_body, fields: [{ field: f_email }, { field: f_email }] },
    form_create_no_title: { ...form_body, title: ' ' },
    form_create_js_redirect: { ...form_body, redirect_url: 'javascript:alert(1)' },
    form_create_unknown_setting: { ...form_body, account_id: me.id },
    form_create_no_table: { ...form_body, file_id: undefined }
};
for (const [name, body] of Object.entries(bad_forms)) {
    await call(name, 'POST', '/form', { token, body, expectFail: true });
}
check(
    'form_create_bad_is_400',
    Object.keys(bad_forms).every(n => results[n]?.status === 400),
    Object.keys(bad_forms).map(n => [n, results[n]?.status])
);
const sform = await call('form_create', 'POST', '/form', { token, body: form_body });
check(
    'form_created',
    /^form_[0-9a-f]{24}$/.test(sform?.id || '') &&
        sform.open === true &&
        sform.file_id === form_table &&
        sform.submissions === 0 &&
        !('account_id' in sform),
    sform
);
const sform_list = await call('form_list_table', 'GET', `/form?table=${form_table}`, { token });
check(
    'form_listed',
    Array.isArray(sform_list?.forms) && sform_list.forms.some(f => f.id === sform?.id),
    sform_list
);
await call('form_get', 'GET', `/form/${sform?.id}`, { token });

// The public link: no token
const PUB = `/public/form/${sform?.id}`;
const pub_view = await call('form_public_view', 'GET', PUB);
check(
    'form_public_view_types',
    JSON.stringify((pub_view?.fields || []).map(f => [f.key, f.label, f.type, f.required])) ===
        JSON.stringify([
            [f_email, 'Your email', 'string', true],
            [f_name, 'Name', 'string', false],
            [f_position, 'Position', 'number', false],
            [f_joined, 'Joined', 'date', false]
        ]) &&
        pub_view.title === form_body.title &&
        pub_view.honeypot === 'website',
    pub_view
);
check(
    'form_public_view_hides_owner',
    pub_view &&
        !('file_id' in pub_view) &&
        !('account_id' in pub_view) &&
        !('thank_you' in pub_view),
    pub_view
);

const submitted = await call('form_submit', 'POST', `${PUB}/submit`, {
    body: {
        values: {
            [f_email]: 'smoke-form@example.com',
            [f_name]: 'Smoke Form',
            [f_position]: '42',
            [f_joined]: '2026-11-25'
        },
        website: ''
    }
});
check(
    'form_submit_answer',
    submitted?.ok === true &&
        submitted.thank_you === 'Thanks, smoke!' &&
        submitted.redirect_url === 'https://example.com/thanks',
    submitted
);
const rows_after_submit = await form_rows('form_rows_after_submit');
const submitted_row = rows_after_submit.find(r => r[f_email] === 'smoke-form@example.com');
check(
    'form_submit_added_row',
    rows_after_submit.length === form_rows_before.length + 1 &&
        submitted_row?.[f_name] === 'Smoke Form' &&
        submitted_row?.[f_position] === 42 &&
        String(submitted_row?.[f_joined]).startsWith('2026-11-25') &&
        (submitted_row?.[f_status] ?? null) === null,
    submitted_row
);

// Wrong answers: a 400 with each field's message, and no row
await call('form_submit_invalid', 'POST', `${PUB}/submit`, {
    body: { values: { [f_email]: '', [f_position]: 'lots', [f_joined]: 'someday' } },
    expectFail: true
});
const invalid = results.form_submit_invalid;
check(
    'form_submit_invalid_fields',
    invalid?.status === 400 &&
        invalid.data?.errors?.[f_email] === 'This field is required' &&
        invalid.data?.errors?.[f_position] === 'Enter a number' &&
        invalid.data?.errors?.[f_joined] === 'Enter a date',
    invalid
);
await call('form_submit_other_column', 'POST', `${PUB}/submit`, {
    body: { values: { [f_email]: 'x@example.com', [f_status]: 'Invited' } },
    expectFail: true
});
check('form_submit_other_column_400', results.form_submit_other_column?.status === 400);
// The honeypot: answered like a submission, but nothing is added
const spam = await call('form_submit_honeypot', 'POST', `${PUB}/submit`, {
    body: { values: { [f_email]: 'bot@example.com' }, website: 'http://spam.example' }
});
check('form_submit_honeypot_ok', spam?.ok === true, spam);
const rows_after_bad = await form_rows('form_rows_after_bad');
check(
    'form_submit_bad_added_nothing',
    rows_after_bad.length === rows_after_submit.length &&
        !rows_after_bad.some(
            r => r[f_email] === 'bot@example.com' || r[f_email] === 'x@example.com'
        ),
    rows_after_bad.length
);
const sform_after = await call('form_get_after_submit', 'GET', `/form/${sform?.id}`, { token });
check('form_submission_counted', sform_after?.submissions === 1, sform_after);

// demo2 can't see, change, close or delete demo's form, nor put one on demo's table; an API
// key can't manage forms. The public link is public, so that's all it can do.
const form_other = await call('form_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const ftoken2 = form_other.token;
const other_forms = await call('form_other_list', 'GET', '/form', { token: ftoken2 });
check(
    'form_other_list_is_own',
    Array.isArray(other_forms?.forms) && !other_forms.forms.some(f => f.id === sform?.id),
    other_forms
);
await call('form_other_list_table', 'GET', `/form?table=${form_table}`, {
    token: ftoken2,
    expectFail: true
});
await call('form_other_get', 'GET', `/form/${sform?.id}`, { token: ftoken2, expectFail: true });
await call('form_other_update', 'PUT', `/form/${sform?.id}`, {
    token: ftoken2,
    body: { open: false, title: 'stolen' },
    expectFail: true
});
await call('form_other_delete', 'DELETE', `/form/${sform?.id}`, {
    token: ftoken2,
    expectFail: true
});
await call('form_other_create_on_table', 'POST', '/form', {
    token: ftoken2,
    body: { ...form_body, title: 'theirs' },
    expectFail: true
});
await call('form_api_key_list', 'GET', '/form', { token: key, expectFail: true });
await call('form_api_key_create', 'POST', '/form', {
    token: key,
    body: form_body,
    expectFail: true
});
await call('form_unauth_list', 'GET', '/form', { expectFail: true });
const sform_after_other = await call('form_get_after_other', 'GET', `/form/${sform?.id}`, {
    token
});
check(
    'form_other_changed_nothing',
    sform_after_other?.open === true && sform_after_other?.title === form_body.title,
    sform_after_other
);
const forms_after_other = await call('form_list_after_other', 'GET', '/form', { token });
check(
    'form_other_created_nothing',
    Array.isArray(forms_after_other?.forms) &&
        !forms_after_other.forms.some(f => f.title === 'theirs'),
    forms_after_other
);
await call('form_other_logout', 'GET', `/auth/logout?token=${ftoken2}`);

// Closed: the link answers 410 and takes nothing; opened again, it works
const closed = await call('form_close', 'PUT', `/form/${sform?.id}`, {
    token,
    body: { open: false }
});
check('form_closed', closed?.open === false, closed);
await call('form_public_closed', 'GET', PUB, { expectFail: true });
await call('form_submit_closed', 'POST', `${PUB}/submit`, {
    body: { values: { [f_email]: 'closed@example.com' } },
    expectFail: true
});
check(
    'form_closed_is_410',
    results.form_public_closed?.status === 410 && results.form_submit_closed?.status === 410,
    [results.form_public_closed, results.form_submit_closed]
);
await call('form_reopen', 'PUT', `/form/${sform?.id}`, { token, body: { open: true } });
await call('form_public_reopened', 'GET', PUB);

// Rate limit: 10 submissions per IP per form in 10 minutes, the refused ones included. The
// ones above used 5, so 5 more are refused for their answers (400) and the next one is a 429.
// The counters are in memory, so a backend restart resets them.
const form_statuses = [];
for (let i = 0; i < 12; i++) {
    const res = await fetch(`${BASE}${PUB}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: { [f_email]: '' } })
    });
    form_statuses.push(res.status);
    if (res.status === 429) break;
}
results.form_rate_limit_statuses = form_statuses;
check(
    'form_submit_rate_limited',
    form_statuses.at(-1) === 429 && form_statuses.slice(0, -1).every(s => s === 400),
    form_statuses
);

// Deleted: the link is a 404
await call('form_delete', 'DELETE', `/form/${sform?.id}`, { token });
await call('form_delete_again', 'DELETE', `/form/${sform?.id}`, { token, expectFail: true });
await call('form_public_deleted', 'GET', PUB, { expectFail: true });
check('form_deleted_is_404', results.form_public_deleted?.status === 404);

// A form on a table that's then deleted: its link is a 404 and the form is gone
const sform2 = await call('form_create_second', 'POST', '/form', {
    token,
    body: { ...form_body, title: 'Second smoke form' }
});
await call('form_public_second', 'GET', `/public/form/${sform2?.id}`);
await call('form_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [form_table] }
});
await call('form_public_table_deleted', 'GET', `/public/form/${sform2?.id}`, { expectFail: true });
check('form_table_deleted_is_404', results.form_public_table_deleted?.status === 404);
await call('form_get_table_deleted', 'GET', `/form/${sform2?.id}`, { token, expectFail: true });
await call('form_public_unknown', 'GET', '/public/form/form_000000000000000000000000', {
    expectFail: true
});

// Saved views (#146), on a table made from the tasks template (Status: In progress, To do,
// Done, To do; Owner: Sam, Ana, Sam, Kai; Estimate Hours: 4, 2, 0.5, 1). A grid view keeps
// filters, sort and hidden columns and can be renamed and deleted; a kanban view groups rows by
// a column, and moving a card is a row update; a chart view counts or sums per value. demo2
// can't see, use, change or delete demo's views, nor put one on demo's table; an API key can't
// use them; deleting the table deletes its views.
const view_table = await call('view_table_create', 'POST', '/table-template/tasks', {
    token,
    body: { name: 'smoke_view_tasks' }
});
const view_cols = await call(
    'view_table_cols',
    'POST',
    `/web-file/data_grid_column/${view_table}?skip=0&limit=50`,
    { token, body: {} }
);
const view_col = name => (view_cols.data || []).find(c => c.headerName === name)?.field;
const [v_task, v_owner, v_status, v_hours, v_due] = [
    'Task',
    'Owner',
    'Status',
    'Estimate Hours',
    'Due'
].map(view_col);
check('view_table_columns', !!(v_task && v_owner && v_status && v_hours && v_due), view_cols);

const grid_view_body = {
    file_id: view_table,
    name: 'Sam smoke',
    type: 'grid',
    filters: [{ field: v_owner, type: 'equals', value: 'Sam' }],
    sort: { field: v_hours, dir: 'desc' },
    hidden_fields: [v_due]
};
const bad_views = {
    view_create_no_name: { ...grid_view_body, name: ' ' },
    view_create_unknown_column: {
        ...grid_view_body,
        filters: [{ field: 'zz', type: 'equals', value: 'x' }]
    },
    view_create_bad_filter_type: {
        ...grid_view_body,
        filters: [{ field: v_owner, type: 'lessThan', value: 'x' }]
    },
    view_create_bad_number: {
        ...grid_view_body,
        filters: [{ field: v_hours, type: 'equals', value: 'lots' }]
    },
    view_create_hide_all: {
        ...grid_view_body,
        hidden_fields: [v_task, v_owner, view_col('Priority'), v_status, v_hours, v_due]
    },
    view_create_unknown_setting: { ...grid_view_body, account_id: me.id },
    view_create_bad_type: { ...grid_view_body, type: 'gantt' },
    view_create_calendar_no_date: { ...grid_view_body, type: 'calendar' },
    view_create_calendar_text: {
        ...grid_view_body,
        type: 'calendar',
        calendar: { date_field: v_status }
    },
    view_create_map_text: {
        ...grid_view_body,
        type: 'map',
        map: { lat_field: v_hours, lng_field: v_status }
    },
    view_create_map_same: {
        ...grid_view_body,
        type: 'map',
        map: { lat_field: v_hours, lng_field: v_hours }
    },
    view_create_kanban_no_group: { ...grid_view_body, type: 'kanban' },
    view_create_kanban_date: { ...grid_view_body, type: 'kanban', kanban: { group_field: v_due } },
    view_create_chart_sum_no_value: {
        ...grid_view_body,
        type: 'chart',
        chart: { kind: 'bar', group_field: v_status, agg: 'sum' }
    },
    view_create_no_table: { ...grid_view_body, file_id: undefined }
};
for (const [name, body] of Object.entries(bad_views)) {
    await call(name, 'POST', '/view', { token, body, expectFail: true });
}
check(
    'view_create_bad_is_400',
    Object.keys(bad_views).every(n => results[n]?.status === 400),
    Object.keys(bad_views).map(n => [n, results[n]?.status])
);

const gview = await call('view_create_grid', 'POST', '/view', { token, body: grid_view_body });
check(
    'view_grid_created',
    /^view_[0-9a-f]{24}$/.test(gview?.id || '') &&
        gview.type === 'grid' &&
        gview.file_id === view_table &&
        gview.filters?.[0]?.value === 'Sam' &&
        gview.sort?.dir === 'desc' &&
        gview.hidden_fields?.[0] === v_due &&
        !('account_id' in gview),
    gview
);
const view_list = await call('view_list', 'GET', `/view?table=${view_table}`, { token });
check(
    'view_listed',
    Array.isArray(view_list?.views) &&
        view_list.views.some(v => v.id === gview?.id) &&
        (view_list.columns || []).some(c => c.field === v_status),
    view_list
);
const renamed = await call('view_rename', 'PUT', `/view/${gview?.id}`, {
    token,
    body: { name: 'Sam renamed' }
});
check('view_renamed', renamed?.name === 'Sam renamed' && renamed?.filters?.length === 1, renamed);
const refiltered = await call('view_update_filters', 'PUT', `/view/${gview?.id}`, {
    token,
    body: { filters: [{ field: v_hours, type: 'greaterThanOrEqual', value: '1' }], sort: null }
});
check(
    'view_filters_updated',
    refiltered?.filters?.[0]?.field === v_hours && refiltered?.sort === null,
    refiltered
);
await call('view_change_table', 'PUT', `/view/${gview?.id}`, {
    token,
    body: { file_id: file_id },
    expectFail: true
});
await call('view_kanban_of_grid', 'GET', `/view/${gview?.id}/kanban`, {
    token,
    expectFail: true
});

// Kanban: a column per Status value, then only Sam's cards
const kview = await call('view_create_kanban', 'POST', '/view', {
    token,
    body: {
        file_id: view_table,
        name: 'Board smoke',
        type: 'kanban',
        kanban: { group_field: v_status },
        sort: { field: v_hours, dir: 'asc' }
    }
});
const board_counts = board =>
    Object.fromEntries((board?.groups || []).map(g => [g.value, g.count]));
const board = await call('view_kanban', 'GET', `/view/${kview?.id}/kanban`, { token });
const todo = (board?.groups || []).find(g => g.value === 'To do');
check(
    'view_kanban_groups',
    board?.group_field === v_status &&
        JSON.stringify(board_counts(board)) ===
            JSON.stringify({ Done: 1, 'In progress': 1, 'To do': 2 }) &&
        todo?.rows?.length === 2 &&
        todo.rows[0][v_hours] === 1 &&
        todo.rows[1][v_hours] === 2,
    board
);
await call('view_kanban_filter', 'PUT', `/view/${kview?.id}`, {
    token,
    body: { filters: [{ field: v_owner, type: 'equals', value: 'Sam' }] }
});
const sam_board = await call('view_kanban_filtered', 'GET', `/view/${kview?.id}/kanban`, {
    token
});
check(
    'view_kanban_filtered',
    JSON.stringify(board_counts(sam_board)) === JSON.stringify({ Done: 1, 'In progress': 1 }),
    sam_board
);
// Dragging the In progress card to Done is a row update
const moving = (sam_board?.groups || []).find(g => g.value === 'In progress')?.rows?.[0];
await call('view_kanban_move', 'PUT', `/web-file/${moving?._id}/data_grid_row/${view_table}`, {
    token,
    body: { _id: moving?._id, [v_status]: 'Done' }
});
const moved_board = await call('view_kanban_moved', 'GET', `/view/${kview?.id}/kanban`, {
    token
});
check(
    'view_kanban_moved',
    JSON.stringify(board_counts(moved_board)) === JSON.stringify({ Done: 2 }) &&
        (moved_board?.groups?.[0]?.rows || []).some(r => r._id === moving?._id),
    moved_board
);

// Charts: rows per Status (bar), hours summed per Owner (pie), rows per Due day (line)
const chart_of = async (name, chart) => {
    const v = await call(`view_create_${name}`, 'POST', '/view', {
        token,
        body: { file_id: view_table, name: `Chart ${name}`, type: 'chart', chart }
    });
    const res = await call(`view_${name}`, 'GET', `/view/${v?.id}/chart`, { token });
    return { view: v, res };
};
const points = res => (res?.points || []).map(p => `${p.label}=${p.value}`).join(',');
const bar = await chart_of('chart_bar', { kind: 'bar', group_field: v_status, agg: 'count' });
check('view_chart_bar', points(bar.res) === 'Done=2,To do=2' && bar.res.kind === 'bar', bar.res);
const pie = await chart_of('chart_pie', {
    kind: 'pie',
    group_field: v_owner,
    agg: 'sum',
    value_field: v_hours
});
check('view_chart_pie_sum', points(pie.res) === 'Sam=4.5,Ana=2,Kai=1', pie.res);
const line = await chart_of('chart_line', { kind: 'line', group_field: v_due, agg: 'count' });
check(
    'view_chart_line_dates',
    points(line.res) === '2026-11-20=1,2026-12-01=1,2026-12-05=1,2026-12-08=1',
    line.res
);
await call('view_chart_of_kanban', 'GET', `/view/${kview?.id}/chart`, {
    token,
    expectFail: true
});

// Calendar (#211): rows placed by Due (2026-11-20, 2026-12-01, 2026-12-05, 2026-12-08), titled
// by Task, read a range of days at a time
const cview = await call('view_create_calendar', 'POST', '/view', {
    token,
    body: {
        file_id: view_table,
        name: 'Due smoke',
        type: 'calendar',
        calendar: { date_field: v_due, title_field: v_task }
    }
});
const cal_days = res => (res?.events || []).map(e => e.date).join(',');
const cal_dec = await call(
    'view_calendar_dec',
    'GET',
    `/view/${cview?.id}/calendar?from=2026-12-01&to=2027-01-01`,
    { token }
);
check(
    'view_calendar_dec',
    cview?.calendar?.date_field === v_due &&
        cal_dec?.from === '2026-12-01' &&
        cal_days(cal_dec) === '2026-12-01,2026-12-05,2026-12-08' &&
        (cal_dec?.events || []).every(e => typeof e.title === 'string' && e.title.length > 0),
    cal_dec
);
const cal_nov = await call(
    'view_calendar_nov',
    'GET',
    `/view/${cview?.id}/calendar?from=2026-11-01&to=2026-12-01`,
    { token }
);
check('view_calendar_nov', cal_days(cal_nov) === '2026-11-20', cal_nov);
const cal_default = await call('view_calendar_default', 'GET', `/view/${cview?.id}/calendar`, {
    token
});
check(
    'view_calendar_default_month',
    /^\d{4}-\d{2}-01$/.test(cal_default?.from || '') && Array.isArray(cal_default?.events),
    cal_default
);
const bad_ranges = {
    view_calendar_bad_day: '?from=2026-12-01&to=soon',
    view_calendar_too_long: '?from=2026-01-01&to=2026-12-01',
    view_calendar_backwards: '?from=2026-12-08&to=2026-12-01',
    view_calendar_half: '?from=2026-12-01'
};
for (const [name, q] of Object.entries(bad_ranges)) {
    await call(name, 'GET', `/view/${cview?.id}/calendar${q}`, { token, expectFail: true });
}
check(
    'view_calendar_bad_range_is_400',
    Object.keys(bad_ranges).every(n => results[n]?.status === 400),
    Object.keys(bad_ranges).map(n => [n, results[n]?.status])
);
await call('view_calendar_of_kanban', 'GET', `/view/${kview?.id}/calendar`, {
    token,
    expectFail: true
});

// Map (#211), on an inventory-template table (Reorder Level: 50, 40, 25, 200; Unit Price: 9.5,
// 18, 14.25, 1.2) standing in for latitude and longitude: 200 isn't a latitude, so that row is
// left off the map and counted as missing
const map_table = await call('view_map_table', 'POST', '/table-template/inventory', {
    token,
    body: { name: 'smoke_view_map' }
});
const map_cols = await call(
    'view_map_table_cols',
    'POST',
    `/web-file/data_grid_column/${map_table}?skip=0&limit=50`,
    { token, body: {} }
);
const map_col = name => (map_cols.data || []).find(c => c.headerName === name)?.field;
const [m_product, m_lat, m_lng] = ['Product', 'Reorder Level', 'Unit Price'].map(map_col);
const mview = await call('view_create_map', 'POST', '/view', {
    token,
    body: {
        file_id: map_table,
        name: 'Map smoke',
        type: 'map',
        map: { lat_field: m_lat, lng_field: m_lng, label_field: m_product }
    }
});
const map_res = await call('view_map', 'GET', `/view/${mview?.id}/map`, { token });
const map_pts = (map_res?.points || [])
    .map(p => `${p.lat},${p.lng}`)
    .sort()
    .join(';');
check(
    'view_map_points',
    map_pts === '25,14.25;40,18;50,9.5' &&
        map_res?.missing === 1 &&
        (map_res?.points || []).some(p => p.label === 'Ceramic mug'),
    map_res
);
await call('view_map_filter', 'PUT', `/view/${mview?.id}`, {
    token,
    body: { filters: [{ field: m_lng, type: 'greaterThan', value: '10' }] }
});
const map_filtered = await call('view_map_filtered', 'GET', `/view/${mview?.id}/map`, { token });
check(
    'view_map_filtered',
    (map_filtered?.points || []).length === 2 && map_filtered?.missing === 0,
    map_filtered
);
await call('view_map_of_calendar', 'GET', `/view/${cview?.id}/map`, { token, expectFail: true });

// demo2 can't see, use, change or delete demo's views, nor put one on demo's table; an API key
// can't use views at all
const view_other = await call('view_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const vtoken2 = view_other.token;
const other_view_calls = {
    view_other_list: ['GET', `/view?table=${view_table}`],
    view_other_get: ['GET', `/view/${kview?.id}`],
    view_other_kanban: ['GET', `/view/${kview?.id}/kanban`],
    view_other_chart: ['GET', `/view/${bar.view?.id}/chart`],
    view_other_calendar: ['GET', `/view/${cview?.id}/calendar`],
    view_other_calendar_range: ['GET', `/view/${cview?.id}/calendar?from=2026-12-01&to=2027-01-01`],
    view_other_map: ['GET', `/view/${mview?.id}/map`],
    view_other_map_rename: ['PUT', `/view/${mview?.id}`, { name: 'mine now' }],
    view_other_map_create: [
        'POST',
        '/view',
        {
            file_id: map_table,
            name: 'on your table',
            type: 'map',
            map: { lat_field: m_lat, lng_field: m_lng }
        }
    ],
    view_other_rename: ['PUT', `/view/${kview?.id}`, { name: 'mine now' }],
    view_other_delete: ['DELETE', `/view/${kview?.id}`],
    view_other_create: ['POST', '/view', { ...grid_view_body, name: 'on your table' }]
};
for (const [name, [method, path, body]] of Object.entries(other_view_calls)) {
    await call(name, method, path, { token: vtoken2, body, expectFail: true });
}
await call('view_other_logout', 'GET', `/auth/logout?token=${vtoken2}`);
await call('view_api_key_list', 'GET', `/view?table=${view_table}`, {
    token: key,
    expectFail: true
});
await call('view_api_key_get', 'GET', `/view/${kview?.id}`, { token: key, expectFail: true });
await call('view_api_key_map', 'GET', `/view/${mview?.id}/map`, { token: key, expectFail: true });
const mview_after = await call('view_map_after_other', 'GET', `/view/${mview?.id}`, { token });
check('view_map_unchanged_by_other', mview_after?.name === 'Map smoke', mview_after);
await call('view_map_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [map_table] }
});
await call('view_map_table_deleted', 'GET', `/view/${mview?.id}/map`, {
    token,
    expectFail: true
});
check('view_map_table_deleted_is_404', results.view_map_table_deleted?.status === 404);
const kview_after = await call('view_get_after_other', 'GET', `/view/${kview?.id}`, { token });
check(
    'view_unchanged_by_other',
    kview_after?.name === 'Board smoke' && kview_after?.filters?.length === 1,
    kview_after
);

// Deleted, a view is gone; deleting the table deletes the rest
await call('view_delete', 'DELETE', `/view/${gview?.id}`, { token });
await call('view_delete_again', 'DELETE', `/view/${gview?.id}`, { token, expectFail: true });
check('view_deleted_is_404', results.view_delete_again?.status === 404);
await call('view_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [view_table] }
});
await call('view_get_table_deleted', 'GET', `/view/${kview?.id}`, { token, expectFail: true });
check('view_table_deleted_is_404', results.view_get_table_deleted?.status === 404);

// Linked tables (#147): a "Contact" link column on a task table points at rows of a contacts
// table. The grid gets labels and a picker; /api/v1 returns ids and expands them on request;
// a link to a row that isn't there is a 400; deleting a linked row clears the links to it.
// demo2 can't link to, pick from or expand demo's tables, nor demo to demo2's.
const link_contacts = await call('link_contacts_create', 'POST', '/table-template/crm', {
    token,
    body: { name: 'smoke_link_contacts' }
});
const link_tasks = await call('link_tasks_create', 'POST', '/table-template/tasks', {
    token,
    body: { name: 'smoke_link_tasks' }
});
const lc_cols = await call(
    'link_contacts_cols',
    'POST',
    `/web-file/data_grid_column/${link_contacts}?skip=0&limit=50`,
    { token, body: {} }
);
const lc_name = (lc_cols.data || []).find(c => c.headerName === 'Name')?.field;
const lc_rows = await call(
    'link_contacts_rows',
    'POST',
    `/web-file/data_grid_row/${link_contacts}?skip=0&limit=50`,
    { token, body: {} }
);
const [ada, bea] = (lc_rows.data || []).map(r => ({ _id: r._id, name: r[lc_name] }));
check('link_contacts_ready', !!(lc_name && ada && bea), lc_rows);

const link_targets = await call('link_targets', 'GET', `/web-file/${link_tasks}/link-targets`, {
    token
});
check(
    'link_targets_list_own_tables',
    Array.isArray(link_targets) &&
        link_targets.some(
            t => t.id === link_contacts && t.columns.some(c => c.field === lc_name)
        ) &&
        link_targets.some(t => t.id === link_tasks),
    link_targets
);

const link_col = await call('link_new_column', 'GET', `/web-file/${link_tasks}/get_new_column`, {
    token
});
const link_col_body = {
    ...link_col,
    headerName: 'Contact',
    deleted: false,
    col_type: 'link',
    link_table_id: link_contacts,
    link_display_field: lc_name
};
await call(
    'link_col_no_table',
    'PUT',
    `/web-file/${link_col?._id}/data_grid_column/${link_tasks}`,
    {
        token,
        body: { ...link_col_body, link_table_id: undefined },
        expectFail: true
    }
);
await call(
    'link_col_unknown_table',
    'PUT',
    `/web-file/${link_col?._id}/data_grid_column/${link_tasks}`,
    { token, body: { ...link_col_body, link_table_id: 999999999 }, expectFail: true }
);
await call('link_col_create', 'PUT', `/web-file/${link_col?._id}/data_grid_column/${link_tasks}`, {
    token,
    body: link_col_body
});
await sleep(500);
const lt_cols = await call(
    'link_tasks_cols',
    'POST',
    `/web-file/data_grid_column/${link_tasks}?skip=0&limit=50`,
    { token, body: {} }
);
const lt_contact = (lt_cols.data || []).find(c => c.headerName === 'Contact');
check(
    'link_col_saved',
    lt_contact?.col_type === 'link' &&
        lt_contact?.link_table_id === link_contacts &&
        lt_contact?.link_display_field === lc_name,
    lt_contact
);
const lf = lt_contact?.field;

// The schema diagram (#208): every table with its columns, laid out, and the link as an arrow
// from the Contact column to the contacts table
const schema = await call('schema_diagram', 'GET', '/file-directory/schema', { token });
const schema_tasks = schema?.tables?.find(t => t.id === link_tasks);
check(
    'schema_diagram_tables_and_link',
    !!schema_tasks &&
        schema.tables.some(
            t => t.id === link_contacts && t.columns.some(c => c.field === lc_name)
        ) &&
        schema_tasks.columns.some(
            c => c.field === lf && c.type === 'link' && c.link_table_id === link_contacts
        ) &&
        schema.links.some(
            l =>
                l.from_table_id === link_tasks &&
                l.from_field === lf &&
                l.to_table_id === link_contacts &&
                !l.suggested
        ) &&
        schema.tables.every(t => Number.isFinite(t.x) && Number.isFinite(t.y)) &&
        schema.width > 0 &&
        schema.height > 0,
    schema
);

// The picker: rows of the contacts table matching the text, labelled by the Name column
const link_options = await call(
    'link_options',
    'GET',
    `/web-file/${link_tasks}/link-options?field=${lf}&q=${encodeURIComponent(ada?.name || '')}`,
    { token }
);
check(
    'link_options_match',
    link_options?.table_id === link_contacts &&
        link_options?.options?.some(o => o._id === ada?._id && o.label === ada?.name) &&
        !link_options.options.some(o => o._id === bea?._id),
    link_options
);
await call('link_options_not_link', 'GET', `/web-file/${link_tasks}/link-options?field=a`, {
    token,
    expectFail: true
});
await call('link_options_no_field', 'GET', `/web-file/${link_tasks}/link-options`, {
    token,
    expectFail: true
});

// Filled from the grid: ids are kept; the grid gets labels for them
const lt_rows = await call(
    'link_tasks_rows',
    'POST',
    `/web-file/data_grid_row/${link_tasks}?skip=0&limit=50`,
    { token, body: {} }
);
const task0 = lt_rows.data?.[0];
const set_link = await call(
    'link_set_from_grid',
    'PUT',
    `/web-file/${task0?._id}/data_grid_row/${link_tasks}`,
    { token, body: { ...task0, [lf]: [ada?._id, bea?._id] } }
);
check(
    'link_set_stored_ids',
    JSON.stringify(set_link?.[lf]) === JSON.stringify([ada?._id, bea?._id]),
    set_link
);
await call('link_set_unknown_row', 'PUT', `/web-file/${task0?._id}/data_grid_row/${link_tasks}`, {
    token,
    body: { ...task0, [lf]: ['0123456789abcdef01234567'] },
    expectFail: true
});
await call('link_set_not_an_id', 'PUT', `/web-file/${task0?._id}/data_grid_row/${link_tasks}`, {
    token,
    body: { ...task0, [lf]: 'alice' },
    expectFail: true
});
// A task row's id isn't a contact: links only reach rows of the linked table
await call(
    'link_set_other_table_row',
    'PUT',
    `/web-file/${task0?._id}/data_grid_row/${link_tasks}`,
    {
        token,
        body: { ...task0, [lf]: [lt_rows.data?.[1]?._id] },
        expectFail: true
    }
);
check(
    'link_bad_values_are_400',
    ['link_set_unknown_row', 'link_set_not_an_id', 'link_set_other_table_row'].every(
        n => results[n]?.status === 400
    )
);
const lt_rows2 = await call(
    'link_tasks_rows_labels',
    'POST',
    `/web-file/data_grid_row/${link_tasks}?skip=0&limit=50`,
    { token, body: {} }
);
check(
    'link_grid_labels',
    lt_rows2?.link_labels?.[lf]?.[ada?._id] === ada?.name &&
        lt_rows2?.link_labels?.[lf]?.[bea?._id] === bea?.name,
    lt_rows2?.link_labels
);

// /api/v1: ids by default, the linked rows with expand; a bad expand is a 400
const ext_link = await call(
    'link_ext_get',
    'GET',
    '/api/v1/get?table=smoke_link_tasks&skip=0&limit=50',
    { token: key }
);
const ext_task0 = ext_link?.data?.find(r => r._id === task0?._id);
check(
    'link_ext_get_ids',
    JSON.stringify(ext_task0?.Contact) === JSON.stringify([ada?._id, bea?._id]),
    ext_task0
);
const ext_link_x = await call(
    'link_ext_get_expand',
    'GET',
    '/api/v1/get?table=smoke_link_tasks&skip=0&limit=50&expand=Contact',
    { token: key }
);
const ext_task0_x = ext_link_x?.data?.find(r => r._id === task0?._id);
check(
    'link_ext_get_expanded',
    Array.isArray(ext_task0_x?.Contact) &&
        ext_task0_x.Contact.length === 2 &&
        ext_task0_x.Contact[0]._id === ada?._id &&
        ext_task0_x.Contact[0].Name === ada?.name &&
        ext_task0_x.Contact[1].Name === bea?.name &&
        typeof ext_task0_x.Contact[0].Email === 'string',
    ext_task0_x
);
const ext_link_q = await call(
    'link_ext_query_expand',
    'POST',
    '/api/v1/query?table=smoke_link_tasks&expand=Contact',
    {
        token: key,
        body: {
            filters: [
                {
                    column: 'Task',
                    op: 'eq',
                    value: task0?.[(lt_cols.data || []).find(c => c.headerName === 'Task')?.field]
                }
            ]
        }
    }
);
check(
    'link_ext_query_expanded',
    ext_link_q?.data?.length === 1 && ext_link_q.data[0].Contact?.[1]?.Name === bea?.name,
    ext_link_q
);
const ext_link_s = await call(
    'link_ext_search_expand_snake',
    'POST',
    '/api/v1/search?table=smoke_link_tasks&skip=0&limit=50&format=snakeCase&expand=contact',
    { token: key, body: {} }
);
check(
    'link_ext_search_expanded_snake',
    ext_link_s?.data?.find(r => r._id === task0?._id)?.contact?.[0]?.name === ada?.name,
    ext_link_s
);
await call(
    'link_ext_expand_not_link',
    'GET',
    '/api/v1/get?table=smoke_link_tasks&skip=0&limit=1&expand=Task',
    {
        token: key,
        expectFail: true
    }
);
await call('link_ext_expand_unknown', 'POST', '/api/v1/query?table=smoke_link_tasks&expand=Nope', {
    token: key,
    body: {},
    expectFail: true
});
const ext_created = await call('link_ext_create', 'POST', '/api/v1/create?table=smoke_link_tasks', {
    token: key,
    body: [{ Task: 'smoke linked task', Contact: [bea?._id] }]
});
await call('link_ext_create_bad', 'POST', '/api/v1/create?table=smoke_link_tasks', {
    token: key,
    body: [{ Task: 'smoke bad link', Contact: ['0123456789abcdef01234567'] }],
    expectFail: true
});
const ext_created_rows = await call(
    'link_ext_created_rows',
    'POST',
    '/api/v1/search?table=smoke_link_tasks&skip=0&limit=50',
    { token: key, body: { Task: { $ctn: 'smoke' } } }
);
const linked_task = ext_created_rows?.data?.find(r => r.Task === 'smoke linked task');
check(
    'link_ext_created',
    JSON.stringify(linked_task?.Contact) === JSON.stringify([bea?._id]) &&
        !ext_created_rows.data.some(r => r.Task === 'smoke bad link'),
    [ext_created, ext_created_rows]
);

// Deleting a contact clears the links to it, from the grid and from the API
await call('link_delete_ada', 'POST', `/web-file/batch_delete/data_grid_row/${link_contacts}`, {
    token,
    body: [ada?._id]
});
const after_ada = await call(
    'link_after_delete_ada',
    'GET',
    '/api/v1/get?table=smoke_link_tasks&skip=0&limit=50',
    { token: key }
);
check(
    'link_delete_cleared_one',
    JSON.stringify(after_ada?.data?.find(r => r._id === task0?._id)?.Contact) ===
        JSON.stringify([bea?._id]),
    after_ada
);
await call('link_delete_bea', 'POST', '/api/v1/delete?table=smoke_link_contacts', {
    token: key,
    body: [bea?._id]
});
const after_bea = await call(
    'link_after_delete_bea',
    'GET',
    '/api/v1/get?table=smoke_link_tasks&skip=0&limit=50',
    { token: key }
);
check(
    'link_delete_cleared_all',
    after_bea?.data?.find(r => r._id === task0?._id)?.Contact === null &&
        after_bea.data.find(r => r._id === linked_task?._id)?.Contact === null,
    after_bea
);

// demo2: can't read the picker or targets of demo's table, link its own table to demo's, or
// expand demo's table; demo can't link to demo2's table
const link_other = await call('link_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const ltoken2 = link_other.token;
await call('link_other_authorize', 'GET', `/auth/authorize?token=${ltoken2}`);
await call('link_other_targets', 'GET', `/web-file/${link_tasks}/link-targets`, {
    token: ltoken2,
    expectFail: true
});
await call('link_other_options', 'GET', `/web-file/${link_tasks}/link-options?field=${lf}`, {
    token: ltoken2,
    expectFail: true
});
await call(
    'link_other_ext_expand',
    'GET',
    '/api/v1/get?table=smoke_link_tasks&skip=0&limit=1&expand=Contact',
    { token: other_me.api_key, expectFail: true }
);
await call('link_api_key_targets', 'GET', `/web-file/${link_tasks}/link-targets`, {
    token: key,
    expectFail: true
});
// demo2's schema diagram has none of demo's tables; an API key can't read one (#208)
const other_schema = await call('schema_diagram_other', 'GET', '/file-directory/schema', {
    token: ltoken2
});
check(
    'schema_diagram_other_account',
    Array.isArray(other_schema?.tables) &&
        !other_schema.tables.some(t => t.id === link_tasks || t.id === link_contacts) &&
        !other_schema.links.some(
            l => l.to_table_id === link_contacts || l.from_table_id === link_tasks
        ),
    other_schema
);
await call('schema_diagram_api_key', 'GET', '/file-directory/schema', {
    token: key,
    expectFail: true
});
await call('schema_diagram_no_token', 'GET', '/file-directory/schema', { expectFail: true });

// Fill a link column by matching (#321): two CRM tables share their Email column. In the
// signups table, Ada's email is in capitals with spaces (still matches), Bram's is empty (no
// match), Chiara's matches two contacts (linked to both) and Dev's cell is already linked to
// Bram (left alone). The preview writes nothing; apply fills the empty cells only.
const match_contacts = await call('match_contacts_create', 'POST', '/table-template/crm', {
    token,
    body: { name: 'smoke_match_contacts' }
});
const match_signups = await call('match_signups_create', 'POST', '/table-template/crm', {
    token,
    body: { name: 'smoke_match_signups' }
});
const mc_cols = await call(
    'match_contacts_cols',
    'POST',
    `/web-file/data_grid_column/${match_contacts}?skip=0&limit=50`,
    { token, body: {} }
);
const mc_email = (mc_cols.data || []).find(c => c.headerName === 'Email')?.field;
const mc_name = (mc_cols.data || []).find(c => c.headerName === 'Name')?.field;
await call('match_contacts_add', 'POST', `/web-file/batch_create/data_grid_row/${match_contacts}`, {
    token,
    body: [{ [mc_name]: 'Chiara Again', [mc_email]: 'chiara@example.com' }]
});
const mc_rows = await call(
    'match_contacts_rows',
    'POST',
    `/web-file/data_grid_row/${match_contacts}?skip=0&limit=50`,
    { token, body: {} }
);
const mc_by_email = email =>
    (mc_rows.data || []).filter(r => r[mc_email] === email).map(r => r._id);
const ms_cols = await call(
    'match_signups_cols',
    'POST',
    `/web-file/data_grid_column/${match_signups}?skip=0&limit=50`,
    { token, body: {} }
);
const ms_email = (ms_cols.data || []).find(c => c.headerName === 'Email')?.field;
const ms_link_col = await call(
    'match_new_column',
    'GET',
    `/web-file/${match_signups}/get_new_column`,
    { token }
);
await call(
    'match_link_col_create',
    'PUT',
    `/web-file/${ms_link_col?._id}/data_grid_column/${match_signups}`,
    {
        token,
        body: {
            ...ms_link_col,
            headerName: 'Contact',
            deleted: false,
            col_type: 'link',
            link_table_id: match_contacts,
            link_display_field: mc_name
        }
    }
);
await sleep(500);
const msf = ms_link_col?.field;
const ms_rows = await call(
    'match_signups_rows',
    'POST',
    `/web-file/data_grid_row/${match_signups}?skip=0&limit=50`,
    { token, body: {} }
);
const ms_row = email => (ms_rows.data || []).find(r => r[ms_email] === email);
const [s_ada, s_bram, s_chiara, s_dev] = [
    'ada@example.com',
    'bram@example.com',
    'chiara@example.com',
    'dev@example.com'
].map(ms_row);
check(
    'match_ready',
    !!(mc_email && ms_email && msf && s_ada && s_bram && s_chiara && s_dev) &&
        mc_by_email('chiara@example.com').length === 2,
    [mc_rows, ms_rows]
);
await call(
    'match_signups_prepare',
    'PUT',
    `/web-file/batch_update/data_grid_row/${match_signups}`,
    {
        token,
        body: [
            { _id: s_ada?._id, [ms_email]: '  ADA@Example.com ' },
            { _id: s_bram?._id, [ms_email]: null },
            { _id: s_dev?._id, [msf]: mc_by_email('bram@example.com') }
        ]
    }
);
const match_body = { field: msf, source_field: ms_email, target_field: mc_email };
const match_preview = await call('match_preview', 'POST', `/web-file/${match_signups}/link-match`, {
    token,
    body: { ...match_body, apply: false }
});
const match_expected = { linked: 2, no_match: 1, multiple: 1, already_linked: 1 };
check(
    'match_preview_counts',
    JSON.stringify(match_preview) === JSON.stringify(match_expected),
    match_preview
);
const match_cells = async name => {
    const res = await call(
        name,
        'POST',
        `/web-file/data_grid_row/${match_signups}?skip=0&limit=50`,
        {
            token,
            body: {}
        }
    );
    const cell = row => (res.data || []).find(r => r._id === row?._id)?.[msf] ?? null;
    return {
        ada: cell(s_ada),
        bram: cell(s_bram),
        chiara: cell(s_chiara),
        dev: cell(s_dev)
    };
};
const before_apply = await match_cells('match_rows_after_preview');
check(
    'match_preview_wrote_nothing',
    before_apply.ada === null &&
        before_apply.chiara === null &&
        JSON.stringify(before_apply.dev) === JSON.stringify(mc_by_email('bram@example.com')),
    before_apply
);
const match_applied = await call('match_apply', 'POST', `/web-file/${match_signups}/link-match`, {
    token,
    body: { ...match_body, apply: true }
});
check(
    'match_apply_counts',
    JSON.stringify(match_applied) === JSON.stringify(match_expected),
    match_applied
);
const after_apply = await match_cells('match_rows_after_apply');
const same_ids = (a, b) =>
    Array.isArray(a) && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
check(
    'match_apply_linked',
    same_ids(after_apply.ada, mc_by_email('ada@example.com')) &&
        same_ids(after_apply.chiara, mc_by_email('chiara@example.com')) &&
        after_apply.bram === null &&
        JSON.stringify(after_apply.dev) === JSON.stringify(mc_by_email('bram@example.com')),
    after_apply
);
// Applied again, nothing is left to fill
const match_again = await call(
    'match_preview_again',
    'POST',
    `/web-file/${match_signups}/link-match`,
    { token, body: { ...match_body, apply: false } }
);
check(
    'match_again_all_linked',
    match_again?.linked === 0 && match_again?.already_linked === 3 && match_again?.no_match === 1,
    match_again
);
// Not a link column, a link column to match on, an unknown column: 400s. demo2 and an API key
// can't use it on demo's table.
await call('match_not_link', 'POST', `/web-file/${match_signups}/link-match`, {
    token,
    body: { ...match_body, field: ms_email },
    expectFail: true
});
await call('match_source_is_link', 'POST', `/web-file/${match_signups}/link-match`, {
    token,
    body: { ...match_body, source_field: msf },
    expectFail: true
});
await call('match_unknown_target', 'POST', `/web-file/${match_signups}/link-match`, {
    token,
    body: { ...match_body, target_field: 'nope' },
    expectFail: true
});
check(
    'match_bad_bodies_are_400',
    ['match_not_link', 'match_source_is_link', 'match_unknown_target'].every(
        n => results[n]?.status === 400
    )
);
await call('match_other_account', 'POST', `/web-file/${match_signups}/link-match`, {
    token: ltoken2,
    body: { ...match_body, apply: true },
    expectFail: true
});
await call('match_api_key', 'POST', `/web-file/${match_signups}/link-match`, {
    token: key,
    body: { ...match_body, apply: true },
    expectFail: true
});
await call('match_tables_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [match_signups, match_contacts] }
});

// API keys (#138), on the two linked tables: a read-only key reads but can't write, a key limited
// to the tasks table can't reach contacts (nor expand its link to them), a revoked key works
// nowhere, only hashes are kept, the key migrated from the old api_key column still works, a key
// can't manage keys, and demo2 can't see, revoke or use demo's keys.
const status_is = (name, status) => check(`${name}_is_${status}`, results[name]?.status === status);
const TASKS = '/api/v1/get?table=smoke_link_tasks&skip=0&limit=1';
const CONTACTS = '/api/v1/get?table=smoke_link_contacts&skip=0&limit=1';
const ro = await make_key('api_key_create_read_only', token, { name: 'smoke ro', access: 'read' });
check(
    'api_key_create_shape',
    typeof ro?.secret === 'string' &&
        ro.secret.length === 32 &&
        ro.key?.prefix === ro.secret.slice(0, 6) &&
        ro.key?.access === 'read' &&
        ro.key?.table_ids === null &&
        !('key_hash' in (ro.key || {})),
    ro?.key
);
await call('api_key_read_only_get', 'GET', TASKS, { token: ro?.secret });
await call('api_key_read_only_query', 'POST', '/api/v1/query?table=smoke_link_tasks', {
    token: ro?.secret,
    body: { limit: 1 }
});
await call('api_key_read_only_create', 'POST', '/api/v1/create?table=smoke_link_tasks', {
    token: ro?.secret,
    body: [{ Task: 'smoke_refused' }],
    expectFail: true
});
status_is('api_key_read_only_create', 403);
await call('api_key_read_only_update', 'PUT', '/api/v1/update?table=smoke_link_tasks', {
    token: ro?.secret,
    body: [{ _id: task0?._id, Task: 'smoke_refused' }],
    expectFail: true
});
status_is('api_key_read_only_update', 403);
await call('api_key_read_only_delete', 'POST', '/api/v1/delete?table=smoke_link_tasks', {
    token: ro?.secret,
    body: [task0?._id],
    expectFail: true
});
status_is('api_key_read_only_delete', 403);
const ro_rows = await call(
    'api_key_read_only_rows_after',
    'GET',
    TASKS.replace('limit=1', 'limit=50'),
    {
        token: key
    }
);
check(
    'api_key_read_only_wrote_nothing',
    !(ro_rows?.data || []).some(r => r.Task === 'smoke_refused') &&
        (ro_rows?.data || []).some(r => r._id === task0?._id),
    ro_rows
);

const scoped = await make_key('api_key_create_scoped', token, {
    name: 'smoke tasks only',
    access: 'read_write',
    table_ids: [link_tasks]
});
check(
    'api_key_scoped_shape',
    JSON.stringify(scoped?.key?.table_ids) === JSON.stringify([link_tasks]) &&
        scoped?.key?.tables?.[0]?.name === 'smoke_link_tasks',
    scoped?.key
);
await call('api_key_scoped_own_table', 'GET', TASKS, { token: scoped?.secret });
await call('api_key_scoped_other_table', 'GET', CONTACTS, {
    token: scoped?.secret,
    expectFail: true
});
status_is('api_key_scoped_other_table', 403);
await call('api_key_scoped_other_table_query', 'POST', '/api/v1/query?table=smoke_link_contacts', {
    token: scoped?.secret,
    body: {},
    expectFail: true
});
await call(
    'api_key_scoped_other_table_openapi',
    'GET',
    '/api/v1/openapi?table=smoke_link_contacts',
    {
        token: scoped?.secret,
        expectFail: true
    }
);
await call('api_key_scoped_expand', 'GET', `${TASKS}&expand=Contact`, {
    token: scoped?.secret,
    expectFail: true
});
status_is('api_key_scoped_expand', 403);
await call(
    'api_key_scoped_query_expand',
    'POST',
    '/api/v1/query?table=smoke_link_tasks&expand=Contact',
    {
        token: scoped?.secret,
        body: {},
        expectFail: true
    }
);
const scoped_made = await call(
    'api_key_scoped_create',
    'POST',
    '/api/v1/create?table=smoke_link_tasks',
    {
        token: scoped?.secret,
        body: [{ Task: 'smoke_scoped' }]
    }
);
const scoped_row = (
    await call('api_key_scoped_find', 'POST', '/api/v1/query?table=smoke_link_tasks', {
        token: scoped?.secret,
        body: { filters: [{ column: 'Task', op: 'eq', value: 'smoke_scoped' }] }
    })
)?.data?.[0];
check('api_key_scoped_created_row', !!scoped_row?._id, scoped_made);
if (scoped_row?._id) {
    await call('api_key_scoped_delete', 'POST', '/api/v1/delete?table=smoke_link_tasks', {
        token: scoped?.secret,
        body: [scoped_row._id]
    });
}
await call(
    'api_key_scoped_other_table_delete',
    'POST',
    '/api/v1/delete?table=smoke_link_contacts',
    {
        token: scoped?.secret,
        body: [],
        expectFail: true
    }
);

// The MCP server (#305): JSON-RPC over POST /mcp with the same API keys. The read-write key sees
// every tool and table, the read-only key no write tools, the tasks-only key one table; a round
// trip of create, query, update and delete; refusals come back as tool errors the agent reads.
let mcp_id = 0;
const mcp = (name, tok, method, params, opts = {}) =>
    call(name, 'POST', '/mcp', {
        token: tok,
        body: { jsonrpc: '2.0', id: ++mcp_id, method, params },
        ...opts
    });
const mcp_tool = async (name, tok, tool, args) =>
    (await mcp(name, tok, 'tools/call', { name: tool, arguments: args }))?.result;
const mcp_value = result => {
    try {
        return JSON.parse(result?.content?.[0]?.text);
    } catch {
        return undefined;
    }
};
const mcp_init = await mcp('mcp_initialize', key, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '1' }
});
check(
    'mcp_initialize_shape',
    mcp_init?.result?.protocolVersion === '2025-06-18' &&
        mcp_init?.result?.serverInfo?.name === 'invokedb' &&
        !!mcp_init?.result?.capabilities?.tools,
    mcp_init
);
await call('mcp_notification', 'POST', '/mcp', {
    token: key,
    body: { jsonrpc: '2.0', method: 'notifications/initialized' }
});
status_is('mcp_notification', 202);
const tool_names = res => (res?.result?.tools || []).map(t => t.name);
const rw_tools = tool_names(await mcp('mcp_tools_rw', key, 'tools/list', {}));
const ro_tools = tool_names(await mcp('mcp_tools_ro', ro?.secret, 'tools/list', {}));
check(
    'mcp_tools_by_key',
    rw_tools.includes('create_rows') &&
        rw_tools.includes('delete_rows') &&
        ro_tools.includes('query_rows') &&
        !ro_tools.some(t => /create|update|delete/.test(t)),
    { rw_tools, ro_tools }
);
const scoped_tables = mcp_value(
    await mcp_tool('mcp_list_tables_scoped', scoped?.secret, 'list_tables', {})
);
check(
    'mcp_list_tables_scoped',
    scoped_tables?.tables?.length === 1 &&
        scoped_tables.tables[0].name === 'smoke_link_tasks' &&
        scoped_tables.tables[0].columns.some(c => c.name === 'Task'),
    scoped_tables
);
const all_tables = mcp_value(await mcp_tool('mcp_list_tables', key, 'list_tables', {}));
check(
    'mcp_list_tables',
    ['smoke_link_tasks', 'smoke_link_contacts'].every(n =>
        (all_tables?.tables || []).some(t => t.name === n && typeof t.rows === 'number')
    ),
    all_tables
);
const described = mcp_value(
    await mcp_tool('mcp_describe_table', key, 'describe_table', { table: 'smoke_link_tasks' })
);
check(
    'mcp_describe_link',
    (described?.columns || []).some(
        c => c.name === 'Contact' && c.type === 'link' && c.links_to === 'smoke_link_contacts'
    ),
    described
);
const mcp_made = await mcp_tool('mcp_create_rows', key, 'create_rows', {
    table: 'smoke_link_tasks',
    rows: [{ Task: 'smoke_mcp' }]
});
check(
    'mcp_create_rows_ok',
    mcp_made?.isError === false && mcp_value(mcp_made)?.created === 1,
    mcp_made
);
const mcp_found = mcp_value(
    await mcp_tool('mcp_query_rows', key, 'query_rows', {
        table: 'smoke_link_tasks',
        filters: [{ column: 'Task', op: 'eq', value: 'smoke_mcp' }],
        fields: ['Task']
    })
);
const mcp_row = mcp_found?.data?.[0];
check('mcp_query_finds_created', !!mcp_row?._id && mcp_row.Task === 'smoke_mcp', mcp_found);
const mcp_updated = await mcp_tool('mcp_update_rows', key, 'update_rows', {
    table: 'smoke_link_tasks',
    rows: [{ _id: mcp_row?._id, Task: 'smoke_mcp_2' }]
});
check('mcp_update_rows_ok', mcp_updated?.isError === false, mcp_updated);
const mcp_counted = mcp_value(
    await mcp_tool('mcp_count_rows', key, 'count_rows', {
        table: 'smoke_link_tasks',
        filters: [{ column: 'Task', op: 'eq', value: 'smoke_mcp_2' }]
    })
);
check('mcp_count_after_update', mcp_counted?.count === 1, mcp_counted);
const mcp_ro_delete = await mcp_tool('mcp_ro_delete', ro?.secret, 'delete_rows', {
    table: 'smoke_link_tasks',
    ids: [mcp_row?._id]
});
check(
    'mcp_ro_delete_refused',
    mcp_ro_delete?.isError === true && /read-only/.test(mcp_ro_delete?.content?.[0]?.text),
    mcp_ro_delete
);
const mcp_deleted = await mcp_tool('mcp_delete_rows', key, 'delete_rows', {
    table: 'smoke_link_tasks',
    ids: [mcp_row?._id]
});
check('mcp_delete_rows_ok', mcp_value(mcp_deleted)?.deleted === 1, mcp_deleted);
const mcp_other = await mcp_tool('mcp_scoped_other_table', scoped?.secret, 'query_rows', {
    table: 'smoke_link_contacts'
});
check(
    'mcp_scoped_other_table_refused',
    mcp_other?.isError === true && /No table/.test(mcp_other?.content?.[0]?.text),
    mcp_other
);
const mcp_bad = await mcp_tool('mcp_bad_filter', key, 'query_rows', {
    table: 'smoke_link_tasks',
    filters: [{ column: 'Nope', op: 'eq', value: 1 }]
});
check('mcp_bad_filter_is_tool_error', mcp_bad?.isError === true, mcp_bad);
// Tables and columns (#329): the read-write key for every table makes a table, adds a column and
// writes rows to it; the read-only and tasks-only keys are refused; the grid's column rules, the
// name in use and the 52-column limit come back as tool errors; demo2 can't see the table
const mcp_text = result => result?.content?.[0]?.text || '';
const mcp_dirs0 = await call('mcp_table_leftovers', 'GET', '/file-directory', { token });
const mcp_leftover = (Array.isArray(mcp_dirs0) ? mcp_dirs0 : []).filter(
    d =>
        (d.type === 'file' && d.name === 'smoke_mcp_table') ||
        (d.type === 'dir' && d.name === 'smoke_mcp_dir')
);
if (mcp_leftover.length) {
    await call('mcp_table_leftovers_delete', 'POST', '/file-directory/batch_delete', {
        token,
        body: { ids: mcp_leftover.map(d => d.id) }
    });
}
const mcp_cols = [
    { name: 'Name', type: 'string' },
    { name: 'Age', type: 'number' }
];
check(
    'mcp_tools_schema',
    rw_tools.includes('create_table') &&
        rw_tools.includes('add_columns') &&
        !ro_tools.includes('create_table') &&
        !ro_tools.includes('add_columns'),
    { rw_tools, ro_tools }
);
const mcp_ro_table = await mcp_tool('mcp_ro_create_table', ro?.secret, 'create_table', {
    name: 'smoke_mcp_table',
    columns: mcp_cols
});
check(
    'mcp_ro_create_table_refused',
    mcp_ro_table?.isError === true && /read-only/.test(mcp_text(mcp_ro_table)),
    mcp_ro_table
);
const mcp_scoped_table = await mcp_tool('mcp_scoped_create_table', scoped?.secret, 'create_table', {
    name: 'smoke_mcp_table',
    columns: mcp_cols
});
check(
    'mcp_scoped_create_table_refused',
    mcp_scoped_table?.isError === true && /limited to some tables/.test(mcp_text(mcp_scoped_table)),
    mcp_scoped_table
);
const mcp_scoped_cols = await mcp_tool('mcp_scoped_add_columns', scoped?.secret, 'add_columns', {
    table: 'smoke_link_tasks',
    columns: [{ name: 'Extra', type: 'string' }]
});
check(
    'mcp_scoped_add_columns_refused',
    mcp_scoped_cols?.isError === true && /limited to some tables/.test(mcp_text(mcp_scoped_cols)),
    mcp_scoped_cols
);
const mcp_link_type = await mcp_tool('mcp_create_table_link_type', key, 'create_table', {
    name: 'smoke_mcp_table',
    columns: [{ name: 'Contact', type: 'link' }]
});
check('mcp_create_table_link_type_refused', mcp_link_type?.isError === true, mcp_link_type);
const mcp_table_made = await mcp_tool('mcp_create_table', key, 'create_table', {
    name: 'smoke_mcp_table',
    columns: mcp_cols
});
const mcp_new_table = mcp_value(mcp_table_made);
check(
    'mcp_create_table_ok',
    mcp_table_made?.isError === false &&
        Number.isInteger(mcp_new_table?.id) &&
        mcp_new_table?.name === 'smoke_mcp_table' &&
        JSON.stringify(mcp_new_table?.columns) === JSON.stringify(mcp_cols),
    mcp_table_made
);
const mcp_table_again = await mcp_tool('mcp_create_table_taken', key, 'create_table', {
    name: 'smoke_mcp_table',
    columns: mcp_cols
});
check(
    'mcp_create_table_taken_refused',
    mcp_table_again?.isError === true && /in use/i.test(mcp_text(mcp_table_again)),
    mcp_table_again
);
// A name used in another folder is refused too; a second table of the same name made in the app
// makes the name ambiguous, so add_columns by name asks for the id instead of guessing
const mcp_dir = await call('mcp_dir_create', 'POST', '/file-directory', {
    token,
    body: { account_id: me.id, name: 'smoke_mcp_dir', type: 'dir' }
});
const mcp_in_dir = await mcp_tool('mcp_create_table_taken_other_folder', key, 'create_table', {
    name: 'smoke_mcp_table',
    folder: 'smoke_mcp_dir',
    columns: mcp_cols
});
check(
    'mcp_create_table_taken_other_folder_refused',
    mcp_in_dir?.isError === true && /in use/i.test(mcp_text(mcp_in_dir)),
    mcp_in_dir
);
await call('mcp_dir_twin_create', 'POST', '/file-directory', {
    token,
    body: {
        account_id: me.id,
        name: 'smoke_mcp_table',
        type: 'file',
        web_file_type: 'data-grid',
        parent_id: mcp_dir
    }
});
const mcp_ambiguous = await mcp_tool('mcp_add_columns_ambiguous', key, 'add_columns', {
    table: 'smoke_mcp_table',
    columns: [{ name: 'Twin', type: 'string' }]
});
check(
    'mcp_add_columns_ambiguous_refused',
    mcp_ambiguous?.isError === true && /give its id/.test(mcp_text(mcp_ambiguous)),
    mcp_ambiguous
);
const mcp_dirs1 = await call('mcp_dir_list', 'GET', '/file-directory', { token });
const mcp_twins = (Array.isArray(mcp_dirs1) ? mcp_dirs1 : []).filter(
    d => d.parent_id === mcp_dir || d.id === mcp_dir
);
// The table in the folder first, then the folder
const mcp_rank = d => (d.type === 'file' ? 0 : 1);
for (const d of mcp_twins.sort((a, b) => mcp_rank(a) - mcp_rank(b))) {
    await call(`mcp_dir_cleanup_${d.type}`, 'POST', '/file-directory/batch_delete', {
        token,
        body: { ids: [d.id] }
    });
}
const mcp_added = await mcp_tool('mcp_add_columns', key, 'add_columns', {
    table: 'smoke_mcp_table',
    columns: [{ name: 'Joined', type: 'date' }]
});
check(
    'mcp_add_columns_ok',
    mcp_added?.isError === false &&
        mcp_value(mcp_added)?.added === 1 &&
        JSON.stringify((mcp_value(mcp_added)?.columns || []).map(c => [c.name, c.type])) ===
            JSON.stringify([
                ['Name', 'string'],
                ['Age', 'number'],
                ['Joined', 'date']
            ]),
    mcp_added
);
const mcp_dup = await mcp_tool('mcp_add_columns_duplicate', key, 'add_columns', {
    table: 'smoke_mcp_table',
    columns: [{ name: 'Name', type: 'string' }]
});
check(
    'mcp_add_columns_duplicate_refused',
    mcp_dup?.isError === true && /Duplicate column name: Name/.test(mcp_text(mcp_dup)),
    mcp_dup
);
// 3 columns + 50: past the most a table can have (52), the plan_limit as a tool error
const mcp_too_many = await mcp_tool('mcp_add_columns_over_cap', key, 'add_columns', {
    table: 'smoke_mcp_table',
    columns: Array.from({ length: 50 }, (_, i) => ({ name: `c${i}`, type: 'string' }))
});
check(
    'mcp_add_columns_over_cap_refused',
    mcp_too_many?.isError === true &&
        /plan_limit/.test(mcp_text(mcp_too_many)) &&
        /columns_per_table/.test(mcp_text(mcp_too_many)),
    mcp_too_many
);
const mcp_new_rows = await mcp_tool('mcp_new_table_rows', key, 'create_rows', {
    table: 'smoke_mcp_table',
    rows: [{ Name: 'Ada', Age: 36, Joined: '2026-01-02' }]
});
check('mcp_new_table_rows_ok', mcp_value(mcp_new_rows)?.created === 1, mcp_new_rows);
const mcp_new_found = mcp_value(
    await mcp_tool('mcp_new_table_query', key, 'query_rows', { table: 'smoke_mcp_table' })
);
check(
    'mcp_new_table_query',
    mcp_new_found?.data?.length === 1 &&
        mcp_new_found.data[0].Name === 'Ada' &&
        mcp_new_found.data[0].Age === 36 &&
        String(mcp_new_found.data[0].Joined).startsWith('2026-01-02'),
    mcp_new_found
);
const mcp_other_tables = mcp_value(
    await mcp_tool('mcp_other_list_tables', other_me.api_key, 'list_tables', {})
);
check(
    'mcp_other_cant_see_new_table',
    Array.isArray(mcp_other_tables?.tables) &&
        !mcp_other_tables.tables.some(t => t.name === 'smoke_mcp_table'),
    mcp_other_tables
);
for (const [n, ref] of [
    ['name', 'smoke_mcp_table'],
    ['id', mcp_new_table?.id]
]) {
    const other = await mcp_tool(`mcp_other_query_by_${n}`, other_me.api_key, 'query_rows', {
        table: ref
    });
    check(
        `mcp_other_query_by_${n}_refused`,
        other?.isError === true && /No table/.test(mcp_text(other)),
        other
    );
    const other_cols = await mcp_tool(
        `mcp_other_add_columns_${n}`,
        other_me.api_key,
        'add_columns',
        {
            table: ref,
            columns: [{ name: 'Sneaky', type: 'string' }]
        }
    );
    check(
        `mcp_other_add_columns_${n}_refused`,
        other_cols?.isError === true && /No table/.test(mcp_text(other_cols)),
        other_cols
    );
}
if (Number.isInteger(mcp_new_table?.id)) {
    await call('mcp_new_table_delete', 'POST', '/file-directory/batch_delete', {
        token,
        body: { ids: [mcp_new_table.id] }
    });
}

const mcp_unknown = await mcp('mcp_unknown_tool', key, 'tools/call', { name: 'drop_everything' });
check('mcp_unknown_tool_error', mcp_unknown?.error?.code === -32602, mcp_unknown);
await mcp('mcp_no_key', undefined, 'tools/list', {}, { expectFail: true });
status_is('mcp_no_key', 401);
await mcp('mcp_session_token', token, 'tools/list', {}, { expectFail: true });
status_is('mcp_session_token', 401);
await call('mcp_get_stream', 'GET', '/mcp', { token: key, expectFail: true });
status_is('mcp_get_stream', 405);

// A table id that isn't one of the account's tables, bad bodies, and a key on the key routes
await call('api_key_create_other_table', 'POST', '/api-key', {
    token,
    body: { name: 'x', access: 'read', table_ids: [link_tasks, 999999999] },
    expectFail: true
});
await call('api_key_create_bad_access', 'POST', '/api-key', {
    token,
    body: { name: 'x', access: 'admin' },
    expectFail: true
});
await call('api_key_create_no_name', 'POST', '/api-key', {
    token,
    body: { access: 'read' },
    expectFail: true
});
await call('api_key_list_with_key', 'GET', '/api-key', { token: key, expectFail: true });
await call('api_key_create_with_key', 'POST', '/api-key', {
    token: key,
    body: { name: 'x', access: 'read_write' },
    expectFail: true
});
await call('api_key_unauth_list', 'GET', '/api-key', { expectFail: true });

// The list: no secrets or hashes; the migrated key (Initial seeds demo's old key) is read-write
// for every table and still works
const DEMO_OLD_KEY = 'fmh99QgCYnufhYDuAYSgpPblGAYgEWi7';
const key_list = await call('api_key_list', 'GET', '/api-key', { token });
const listed = key_list?.keys || [];
const list_text = JSON.stringify(key_list);
check(
    'api_key_list_has_keys',
    [ro?.key?.id, scoped?.key?.id].every(id => listed.some(k => k.id === id)) &&
        Array.isArray(key_list?.tables) &&
        key_list.tables.some(t => t.id === link_tasks),
    key_list
);
check(
    'api_key_list_no_secrets',
    ![me.api_key, ro?.secret, scoped?.secret, DEMO_OLD_KEY].some(s => s && list_text.includes(s)) &&
        !list_text.includes('key_hash'),
    key_list
);
const migrated = listed.find(k => k.prefix === DEMO_OLD_KEY.slice(0, 6));
check(
    'api_key_migrated_listed',
    migrated?.access === 'read_write' &&
        migrated?.table_ids === null &&
        !migrated?.revoked_datetime,
    migrated
);
await call('api_key_migrated_works', 'GET', TASKS, { token: DEMO_OLD_KEY });
const used = (await call('api_key_list_after_use', 'GET', '/api-key', { token }))?.keys?.find(
    k => k.id === ro?.key?.id
);
check('api_key_last_used', !!used?.last_used_datetime, used);

// demo2: can't see or revoke demo's keys, and its own key can't reach demo's tables
const lkey2 = other_me.api_key;
const other_keys = await call('api_key_other_list', 'GET', '/api-key', { token: ltoken2 });
check(
    'api_key_other_list_is_own',
    !(other_keys?.keys || []).some(k =>
        [ro?.key?.id, scoped?.key?.id, migrated?.id].includes(k.id)
    ),
    other_keys
);
await call('api_key_other_revoke', 'DELETE', `/api-key/${ro?.key?.id}`, {
    token: ltoken2,
    expectFail: true
});
await call('api_key_other_table_ids', 'POST', '/api-key', {
    token: ltoken2,
    body: { name: 'x', access: 'read', table_ids: [link_tasks] },
    expectFail: true
});
await call('api_key_other_key_on_own_table', 'GET', TASKS, { token: lkey2, expectFail: true });
await call('api_key_still_works_after_other_revoke', 'GET', TASKS, { token: ro?.secret });

// Revoked: refused everywhere at once, listed as revoked, and can't be revoked into life again
const revoked = await call('api_key_revoke', 'DELETE', `/api-key/${ro?.key?.id}`, { token });
check('api_key_revoke_marked', !!revoked?.revoked_datetime, revoked);
// Still listed right after revoking (as revoked); only keys revoked REVOKED_KEPT_DAYS ago are
// deleted when the list is read (#178)
const keys_after_revoke = await call('api_key_list_after_revoke', 'GET', '/api-key', { token });
const listed_revoked = keys_after_revoke?.keys?.find(k => k.id === ro?.key?.id);
check(
    'api_key_revoked_listed',
    !!listed_revoked?.revoked_datetime && keys_after_revoke?.revoked_kept_days > 0,
    keys_after_revoke
);
await call('api_key_revoked_get', 'GET', TASKS, { token: ro?.secret, expectFail: true });
status_is('api_key_revoked_get', 401);
await call('api_key_revoked_other_table', 'GET', CONTACTS, { token: ro?.secret, expectFail: true });
await call('api_key_revoked_query', 'POST', '/api/v1/query?table=smoke_link_tasks', {
    token: ro?.secret,
    body: {},
    expectFail: true
});
await call('api_key_revoke_again', 'DELETE', `/api-key/${ro?.key?.id}`, { token });
// The audit log (#217) has the revoke once, on no table
const audit_revoked = await call('audit_after_revoke', 'GET', '/audit?limit=100', { token });
check(
    'audit_key_revoked_once',
    (audit_revoked?.entries || []).filter(
        e => e.action === 'api_key.revoked' && e.details?.key_prefix === ro?.key?.prefix
    ).length === 1,
    (audit_revoked?.entries || []).slice(0, 3)
);
await call('api_key_revoke_unknown', 'DELETE', '/api-key/999999999', { token, expectFail: true });
await call('api_key_revoke_bad_id', 'DELETE', '/api-key/abc', { token, expectFail: true });
await call('api_key_other_keys_unaffected', 'GET', TASKS, { token: scoped?.secret });

// A key's own rate limit and its request log (#216): a key allowed bursts of 2 that refill
// slowly answers its third quick call with 429 and Retry-After; its last requests (no query
// strings) are listed for its owner only.
await call('api_key_create_bad_rate', 'POST', '/api-key', {
    token,
    body: { name: 'x', access: 'read', rate_limit_per_second: 0 },
    expectFail: true
});
status_is('api_key_create_bad_rate', 400);
await call('api_key_create_burst_no_rate', 'POST', '/api-key', {
    token,
    body: { name: 'x', access: 'read', rate_limit_burst: 3 },
    expectFail: true
});
const limited = await make_key('api_key_create_limited', token, {
    name: 'smoke limited',
    access: 'read',
    rate_limit_per_second: 0.1,
    rate_limit_burst: 2
});
check(
    'api_key_limited_shape',
    limited?.key?.rate_limit?.per_second === 0.1 && limited?.key?.rate_limit?.burst === 2,
    limited?.key
);
check('api_key_unlimited_shape', scoped?.key?.rate_limit === null, scoped?.key);
await call('api_key_limited_1', 'GET', TASKS, { token: limited?.secret });
await call('api_key_limited_2', 'GET', TASKS, { token: limited?.secret });
{
    const res = await fetch(BASE + TASKS, {
        headers: { Authorization: `Bearer ${limited?.secret}` }
    });
    const body = await res.json().catch(() => null);
    results.api_key_limited_3 = { status: res.status, data: body };
    const retry_after = Number(res.headers.get('retry-after'));
    check(
        'api_key_limited_429_retry_after',
        res.status === 429 && Number.isInteger(retry_after) && retry_after >= 1,
        { status: res.status, retry_after: res.headers.get('retry-after'), body }
    );
}
// Another key of the same account isn't held back by it
await call('api_key_limit_is_per_key', 'GET', TASKS, { token: scoped?.secret });

// The log is written once each response is sent, so give it a moment
let limited_log;
for (let i = 0; i < 20; i++) {
    limited_log = await call('api_key_requests', 'GET', `/api-key/${limited?.key?.id}/requests`, {
        token
    });
    if ((limited_log?.requests || []).length >= 3) break;
    await sleep(250);
}
const logged = limited_log?.requests || [];
check(
    'api_key_requests_logged',
    logged.length === 3 &&
        JSON.stringify(logged.map(r => r.status)) === JSON.stringify([429, 200, 200]) &&
        logged.every(
            r =>
                r.method === 'GET' &&
                r.path === '/api/v1/get' &&
                typeof r.at === 'number' &&
                typeof r.duration_ms === 'number'
        ) &&
        logged[0].at >= logged[2].at &&
        limited_log?.max === 100,
    limited_log
);
check(
    'api_key_requests_no_query',
    !JSON.stringify(limited_log).includes('smoke_link_tasks') &&
        !JSON.stringify(limited_log).includes('limit='),
    limited_log
);
await call('api_key_requests_other_account', 'GET', `/api-key/${limited?.key?.id}/requests`, {
    token: ltoken2,
    expectFail: true
});
status_is('api_key_requests_other_account', 404);
await call('api_key_requests_with_key', 'GET', `/api-key/${limited?.key?.id}/requests`, {
    token: limited?.secret,
    expectFail: true
});
await call('api_key_requests_no_token', 'GET', `/api-key/${limited?.key?.id}/requests`, {
    expectFail: true
});
await call('api_key_requests_unknown', 'GET', '/api-key/999999999/requests', {
    token,
    expectFail: true
});
status_is('api_key_requests_unknown', 404);
// demo2 needs a table of its own: a new one if it's under the free tier's limit
const other_link_files = await call('link_other_list', 'GET', '/file-directory', {
    token: ltoken2
});
let other_table = (Array.isArray(other_link_files) ? other_link_files : []).find(
    d => d.type === 'file'
)?.id;
let other_table_made = false;
if (!other_table) {
    other_table = await call('link_other_table_create', 'POST', '/table-template/waitlist', {
        token: ltoken2,
        body: { name: 'smoke_link_theirs' }
    });
    other_table_made = true;
}
const other_targets = await call(
    'link_other_own_targets',
    'GET',
    `/web-file/${other_table}/link-targets`,
    { token: ltoken2 }
);
check(
    'link_other_targets_are_own',
    Array.isArray(other_targets) &&
        !other_targets.some(t => t.id === link_contacts || t.id === link_tasks),
    other_targets
);
const other_col = await call(
    'link_other_new_column',
    'GET',
    `/web-file/${other_table}/get_new_column`,
    {
        token: ltoken2
    }
);
await call(
    'link_other_col_to_demo',
    'PUT',
    `/web-file/${other_col?._id}/data_grid_column/${other_table}`,
    {
        token: ltoken2,
        body: {
            ...other_col,
            headerName: 'Stolen',
            deleted: false,
            col_type: 'link',
            link_table_id: link_contacts
        },
        expectFail: true
    }
);
await call(
    'link_other_batch_col_to_demo',
    'PUT',
    `/web-file/batch_update/data_grid_column/${other_table}`,
    {
        token: ltoken2,
        body: [
            {
                ...other_col,
                headerName: 'Stolen',
                deleted: false,
                col_type: 'link',
                link_table_id: link_contacts
            }
        ],
        expectFail: true
    }
);
await call(
    'link_col_to_other',
    'PUT',
    `/web-file/${link_col?._id}/data_grid_column/${link_tasks}`,
    {
        token,
        body: { ...link_col_body, link_table_id: other_table },
        expectFail: true
    }
);
const lt_cols_after = await call(
    'link_tasks_cols_after_other',
    'POST',
    `/web-file/data_grid_column/${link_tasks}?skip=0&limit=50`,
    { token, body: {} }
);
check(
    'link_col_still_own',
    (lt_cols_after.data || []).find(c => c.field === lf)?.link_table_id === link_contacts,
    lt_cols_after
);
if (other_table_made) {
    await call('link_other_table_delete', 'POST', '/file-directory/batch_delete', {
        token: ltoken2,
        body: { ids: [other_table] }
    });
}
// The keys this test made for demo2 (#138)
for (const [i, k] of smoke_keys.filter(k => k.owner === otoken).entries()) {
    await call(`api_key_cleanup_other_${i}`, 'DELETE', `/api-key/${k.id}`, { token: ltoken2 });
}
await call('link_other_logout', 'GET', `/auth/logout?token=${ltoken2}`);

// Deleting the linked table (#175) empties the cells that pointed at it, and the column
// becomes a plain string column, so it no longer names a deleted table
const cara = lc_rows.data?.[2];
await call('link_set_cara', 'PUT', `/web-file/${task0?._id}/data_grid_row/${link_tasks}`, {
    token,
    body: { ...task0, [lf]: [cara?._id] }
});
await call('link_contacts_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [link_contacts] }
});
const after_table = await call(
    'link_after_table_delete',
    'GET',
    '/api/v1/get?table=smoke_link_tasks&skip=0&limit=50',
    { token: key }
);
check(
    'link_table_delete_cleared_cells',
    Array.isArray(after_table?.data) &&
        after_table.data.length > 0 &&
        after_table.data.every(r => r.Contact === null || r.Contact === undefined),
    after_table
);
const lt_cols_unlinked = await call(
    'link_tasks_cols_after_table_delete',
    'POST',
    `/web-file/data_grid_column/${link_tasks}?skip=0&limit=50`,
    { token, body: {} }
);
const unlinked = (lt_cols_unlinked.data || []).find(c => c.field === lf);
check(
    'link_table_delete_column_is_string',
    unlinked?.col_type === 'string' &&
        unlinked.link_table_id === undefined &&
        unlinked.link_display_field === undefined,
    unlinked
);
// ...and the schema diagram no longer draws it (#208)
const schema_unlinked = await call(
    'schema_diagram_after_table_delete',
    'GET',
    '/file-directory/schema',
    { token }
);
check(
    'schema_diagram_link_gone',
    Array.isArray(schema_unlinked?.tables) &&
        !schema_unlinked.tables.some(t => t.id === link_contacts) &&
        !schema_unlinked.links.some(l => l.from_table_id === link_tasks),
    schema_unlinked
);
// It takes text again
const unlinked_set = await call(
    'link_unlinked_column_text',
    'PUT',
    `/web-file/${task0?._id}/data_grid_row/${link_tasks}`,
    { token, body: { ...task0, [lf]: 'just text' } }
);
check('link_unlinked_column_takes_text', unlinked_set?.[lf] === 'just text', unlinked_set);
await call('link_tables_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [link_tasks] }
});

// Ask your data (#149). smoke-env.sh points the backend's ANTHROPIC_BASE_URL at a stub of the
// Messages API on 127.0.0.1:8197, so no real model is called: the stub answers the first turn
// with the run_query input the test sets, and the next with a text that says what the tool
// returned. Checks the answer, the rows, that the API call returns the same rows, that a bad
// query never runs, the monthly cap (demo3, free tier) and that demo2 and API keys are locked out.
const AI_KEY = 'smoke-anthropic-key';
const ai_requests = [];
let ai_next_input = {};
// The tool the stub calls first: run_query, or propose_rows to test asking for rows (#234)
let ai_next_tool = 'run_query';
// Or a script of tool calls (#322), `[{ name, input }]`: the stub makes the nth call once n
// tool results are in the conversation, and answers as below after the last one
let ai_next_script = null;
// What the stub says each call used (a big number tests the cost cap)
let ai_next_usage = { input_tokens: 50, output_tokens: 5 };
// The stub's answer to a cleanup scan (#206): spellings and near-duplicate rows
let ai_next_cleanup = { spellings: [], near_duplicates: [] };
// The stub's answer to pasted text (#207): the rows the test sets
let ai_next_import = { rows: [] };
// The stub's answer to a structured-output request (#148): a table design, or the rows the
// prompt asks for ("Generate exactly N new rows."), text values "<column> <n>"
function ai_stub_json(body) {
    const props = body.output_config.format.schema.properties || {};
    // A cleanup scan (#206): what the test sets
    if (props.spellings) return ai_next_cleanup;
    // An AI column (#205): "AI: <the row's first value>" for every numbered row of the prompt
    if (props.values) {
        const prompt = String(body.messages?.[0]?.content || '');
        const values = [...prompt.matchAll(/^(\d+): (\{.*\})$/gm)].map(m => ({
            row: Number(m[1]),
            value: `AI: ${Object.values(JSON.parse(m[2]))[0]}`
        }));
        return { values };
    }
    if (props.columns) {
        return {
            table_name: 'stub_table',
            columns: [
                { name: 'Name', type: 'string' },
                { name: 'Amount', type: 'number' },
                { name: 'Date', type: 'date' }
            ]
        };
    }
    const prompt = String(body.messages?.[0]?.content || '');
    // Pasted text (#207): what the test sets
    if (prompt.includes('<pasted_text>')) return ai_next_import;
    const n = Number((/exactly (\d+) new rows/.exec(prompt) || [])[1] || 0);
    const item = props.rows.items.properties;
    const rows = [];
    for (let i = 0; i < n; i++) {
        const row = {};
        for (const [field, schema] of Object.entries(item)) {
            const typed = schema.anyOf[0];
            const label = String(schema.description).split(' (')[0];
            row[field] =
                typed.type === 'number'
                    ? i + 1
                    : typed.format === 'date'
                      ? `2026-01-0${(i % 9) + 1}`
                      : `${label} ${i + 1}`;
        }
        rows.push(row);
    }
    return { rows };
}
const ai_stub = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
        let body = {};
        try {
            body = JSON.parse(raw);
        } catch {}
        const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
        ai_requests.push({ path: req.url, key: req.headers['x-api-key'] || bearer, body });
        const last = (body.messages || [])[body.messages.length - 1];
        const result = Array.isArray(last?.content)
            ? last.content.find(c => c.type === 'tool_result')
            : null;
        // Generated rows and table designs (#148) ask for JSON in a schema
        const structured = !!body.output_config?.format;
        const results_so_far = (body.messages || []).filter(
            m => Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result')
        ).length;
        const scripted = !structured && ai_next_script ? ai_next_script[results_so_far] : null;
        // A new table from a description in an account with tables (#324) offers propose_table;
        // unscripted, the stub answers the same design as a structured one, without rows
        const designing = (body.tools || []).some(t => t.name === 'propose_table');
        let content;
        if (scripted) {
            content = [
                {
                    type: 'tool_use',
                    id: `toolu_smoke_${ai_requests.length}`,
                    name: scripted.name,
                    input: scripted.input
                }
            ];
        } else if (structured) {
            content = [{ type: 'text', text: JSON.stringify(ai_stub_json(body)) }];
        } else if (designing) {
            content = [
                {
                    type: 'tool_use',
                    id: `toolu_smoke_${ai_requests.length}`,
                    name: 'propose_table',
                    input: ai_stub_json({
                        output_config: { format: { schema: { properties: { columns: {} } } } }
                    })
                }
            ];
        } else if (!result) {
            content = [
                {
                    type: 'tool_use',
                    id: `toolu_smoke_${ai_requests.length}`,
                    name: ai_next_tool,
                    input: ai_next_input
                }
            ];
        } else if (result.is_error) {
            content = [{ type: 'text', text: `Stub: the query failed (${result.content})` }];
        } else {
            const out = JSON.parse(result.content);
            content = [{ type: 'text', text: `Stub: ${out.total_matching} rows match` }];
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(
            JSON.stringify({
                id: `msg_smoke_${ai_requests.length}`,
                type: 'message',
                role: 'assistant',
                model: body.model,
                content,
                stop_reason: content[0].type === 'tool_use' ? 'tool_use' : 'end_turn',
                stop_sequence: null,
                usage: ai_next_usage
            })
        );
    });
});
const ai_stub_up = await new Promise(resolve => {
    ai_stub.once('error', err => resolve(err));
    ai_stub.listen(8197, '127.0.0.1', () => resolve(true));
});
check('ai_stub_listening', ai_stub_up === true, String(ai_stub_up));

const ai_status = await call('ai_status', 'GET', '/ai/status', { token });
check(
    'ai_status_available',
    ai_status?.available === true && ai_status?.usage?.limit > 0,
    ai_status
);
const ai_used_before = ai_status?.usage?.used ?? 0;

ai_next_input = {
    filters: [{ column: 'age', op: 'gt', value: 26 }],
    sort: [{ column: 'age', dir: 'desc' }],
    fields: ['name', 'age']
};
let ai_seen = ai_requests.length;
const ai_ask = await call('ai_ask', 'POST', '/ai/ask', {
    token,
    body: { table: file_id, question: 'Who is older than 26?' }
});
const ai_turns = ai_requests.slice(ai_seen);
check(
    'ai_ask_model_called',
    ai_turns.length === 2 &&
        ai_turns.every(r => r.path === '/v1/messages' && r.key === AI_KEY) &&
        // Haiku at low effort, no forced tool call (docs/PRICING.md 3.5)
        ai_turns[0].body.model === 'claude-haiku-5-5' &&
        ai_turns[0].body.output_config?.effort === 'low' &&
        ai_turns[0].body.tool_choice?.type === 'auto' &&
        String(ai_turns[0].body.system).includes('smoke_people') &&
        String(ai_turns[0].body.system).includes('"age" (') &&
        // With other tables (#322) column names are plain strings and table picks one
        (ai_turns[0].body.tools?.[0]?.input_schema?.properties?.fields?.items?.enum?.includes(
            'age'
        ) ||
            ai_turns[0].body.tools?.[0]?.input_schema?.properties?.table?.type === 'string'),
    ai_turns.map(r => ({
        path: r.path,
        model: r.body.model,
        effort: r.body.output_config?.effort,
        choice: r.body.tool_choice
    }))
);
const ai_ages = (ai_ask?.rows || []).map(r => r.age);
check(
    'ai_ask_answer_and_rows',
    typeof ai_ask?.answer === 'string' &&
        ai_ask.answer === `Stub: ${ai_ask.total} rows match` &&
        ai_ages.length === Math.min(ai_ask.total, 20) &&
        ai_ages.length > 0 &&
        ai_ages.every(a => a > 26) &&
        ai_ages.every((a, i) => i === 0 || ai_ages[i - 1] >= a) &&
        JSON.stringify(ai_ask.columns) === '["name","age"]',
    ai_ask
);
check(
    'ai_ask_api_call',
    ai_ask?.api_call?.method === 'POST' &&
        ai_ask.api_call.url === `${BASE}/api/v1/query?table=smoke_people` &&
        ai_ask.api_call.curl.includes('Authorization: Bearer'),
    ai_ask?.api_call
);
// The API call it shows returns the same rows
const ai_api_rows = await call('ai_ask_api_call_run', 'POST', '/api/v1/query?table=smoke_people', {
    token: key,
    body: ai_ask?.api_call?.body
});
check(
    'ai_ask_api_call_same_rows',
    JSON.stringify((ai_api_rows?.data || []).map(r => r._id)) ===
        JSON.stringify((ai_ask?.rows || []).map(r => r._id)),
    ai_api_rows
);

// Model output that isn't a valid read-only query goes back to the model as an error; nothing
// runs and no API call is shown
const ai_bad_inputs = {
    operator: { filters: [{ column: 'age', op: '$where', value: 'sleep(1000)' }] },
    unknown_column: { filters: [{ column: 'password', op: 'eq', value: 'x' }] },
    wrong_type: { filters: [{ column: 'age', op: 'gt', value: { $gt: 0 } }] },
    cursor: { cursor: 'x' },
    write: { update: { name: 'pwned' } },
    limit: { limit: 5000 }
};
for (const [name, input] of Object.entries(ai_bad_inputs)) {
    ai_next_input = input;
    ai_seen = ai_requests.length;
    const res = await call(`ai_ask_bad_${name}`, 'POST', '/ai/ask', {
        token,
        body: { table: file_id, question: 'Do something' }
    });
    const turns = ai_requests.slice(ai_seen);
    const tool_result = turns[1]?.body?.messages?.at(-1)?.content?.[0];
    check(
        `ai_ask_bad_${name}_refused`,
        res?.api_call === null &&
            Array.isArray(res?.rows) &&
            res.rows.length === 0 &&
            tool_result?.is_error === true &&
            String(res?.answer).startsWith('Stub: the query failed'),
        { res, tool_result }
    );
}
const ai_rows_after = await call(
    'ai_rows_after_bad',
    'POST',
    `/web-file/data_grid_row/${file_id}?skip=0&limit=50`,
    { token, body: {} }
);
check(
    'ai_bad_changed_nothing',
    !(ai_rows_after?.data || []).some(r => Object.values(r).includes('pwned')),
    ai_rows_after
);
const ai_status_after = await call('ai_status_after', 'GET', '/ai/status', { token });
check(
    'ai_usage_counted',
    ai_status_after?.usage?.used === ai_used_before + 1 + Object.keys(ai_bad_inputs).length,
    { before: ai_used_before, after: ai_status_after }
);

// Bad requests are 400s and don't reach the model
ai_seen = ai_requests.length;
const ai_bad_requests = {
    ai_ask_no_question: { table: file_id },
    ai_ask_blank_question: { table: file_id, question: '   ' },
    ai_ask_long_question: { table: file_id, question: 'x'.repeat(501) },
    ai_ask_no_table: { question: 'How many?' }
};
for (const [name, body] of Object.entries(ai_bad_requests)) {
    await call(name, 'POST', '/ai/ask', { token, body, expectFail: true });
    check(`${name}_400`, results[name]?.status === 400, results[name]);
}
await call('ai_ask_unknown_table', 'POST', '/ai/ask', {
    token,
    body: { table: 99999999, question: 'How many?' },
    expectFail: true
});
// demo2 can't ask about demo's table, and an API key can't use the AI routes
const ai_other = await call('ai_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const ai_otoken = ai_other.token;
const ai_other_before = await call('ai_other_status', 'GET', '/ai/status', { token: ai_otoken });
await call('ai_other_ask', 'POST', '/ai/ask', {
    token: ai_otoken,
    body: { table: file_id, question: 'What is in this table?' },
    expectFail: true
});
const ai_other_after = await call('ai_other_status_after', 'GET', '/ai/status', {
    token: ai_otoken
});
check(
    'ai_other_usage_own',
    ai_other_after?.usage?.used === ai_other_before?.usage?.used,
    ai_other_after
);
await call('ai_other_logout', 'GET', `/auth/logout?token=${ai_otoken}`);
await call('ai_api_key_ask', 'POST', '/ai/ask', {
    token: key,
    body: { table: file_id, question: 'How many?' },
    expectFail: true
});
await call('ai_api_key_status', 'GET', '/ai/status', { token: key, expectFail: true });
await call('ai_no_token_ask', 'POST', '/ai/ask', {
    body: { table: file_id, question: 'How many?' },
    expectFail: true
});
check('ai_refused_never_called_model', ai_requests.length === ai_seen, ai_requests.slice(ai_seen));
const ai_status_end = await call('ai_status_end', 'GET', '/ai/status', { token });
check(
    'ai_usage_not_counted_for_refused',
    ai_status_end?.usage?.used === ai_status_after?.usage?.used,
    ai_status_end
);

// The monthly cap (demo3, free tier): questions until a 429, which must come at the limit.
// Reruns in the same month start at the limit, so the next question is the 429.
const ai_cap = await call('ai_cap_login', 'POST', '/auth/login', {
    body: { email: 'demo3@invokedb.com', password: 'password' }
});
const ai_ctoken = ai_cap.token;
const ai_cap_table = await call('ai_cap_table', 'POST', '/table-template/waitlist', {
    token: ai_ctoken,
    body: { name: 'smoke_ai_cap' }
});
const ai_cap_status = await call('ai_cap_status', 'GET', '/ai/status', { token: ai_ctoken });
const ai_cap_limit = ai_cap_status?.usage?.limit ?? 0;
check('ai_cap_free_tier', ai_cap_status?.usage?.tier === 'FREE' && ai_cap_limit > 0, ai_cap_status);
ai_next_input = {};
let ai_cap_hit = null;
for (let i = ai_cap_status?.usage?.used ?? 0; i <= ai_cap_limit; i++) {
    const res = await fetch(`${BASE}/ai/ask`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ai_ctoken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: ai_cap_table, question: `Question ${i}` })
    });
    // A question answered is a 201 (POST); stop at the first refusal
    if (!res.ok) {
        ai_cap_hit = { at: i, status: res.status, body: await res.text() };
        break;
    }
    await res.text();
}
check('ai_cap_429_at_limit', ai_cap_hit?.status === 429 && ai_cap_hit.at === ai_cap_limit, {
    ai_cap_hit,
    ai_cap_limit
});
const ai_cap_end = await call('ai_cap_status_end', 'GET', '/ai/status', { token: ai_ctoken });
check('ai_cap_used_is_limit', ai_cap_end?.usage?.used === ai_cap_limit, ai_cap_end);
await call('ai_cap_table_delete', 'POST', '/file-directory/batch_delete', {
    token: ai_ctoken,
    body: { ids: [ai_cap_table] }
});
await call('ai_cap_logout', 'GET', `/auth/logout?token=${ai_ctoken}`);

// The monthly cost cap (demo4, free tier, $0.05): the stub says each call read 600k tokens
// ($0.06 on Haiku), so after one question the next is a 429 for the allowance, well under the
// question count. Reruns in the same month are over the budget from the start.
const ai_cost = await call('ai_cost_login', 'POST', '/auth/login', {
    body: { email: 'demo4@invokedb.com', password: 'password' }
});
const ai_cost_token = ai_cost.token;
const ai_cost_table = await call('ai_cost_table', 'POST', '/table-template/waitlist', {
    token: ai_cost_token,
    body: { name: 'smoke_ai_cost' }
});
ai_next_input = {};
ai_next_usage = { input_tokens: 600000, output_tokens: 0 };
let ai_cost_hit = null;
for (let i = 0; i < 3; i++) {
    const res = await fetch(`${BASE}/ai/ask`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ai_cost_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table: ai_cost_table, question: `Costly question ${i}` })
    });
    if (!res.ok) {
        ai_cost_hit = { at: i, status: res.status, body: await res.text() };
        break;
    }
    await res.text();
}
ai_next_usage = { input_tokens: 50, output_tokens: 5 };
const ai_cost_end = await call('ai_cost_status', 'GET', '/ai/status', { token: ai_cost_token });
check(
    'ai_cost_cap_429',
    ai_cost_hit?.status === 429 &&
        ai_cost_hit.at <= 1 &&
        ai_cost_hit.body.includes('AI allowance') &&
        ai_cost_end?.usage?.used < ai_cost_end?.usage?.limit &&
        ai_cost_end?.usage?.budget_used === 1,
    { ai_cost_hit, usage: ai_cost_end?.usage }
);
await call('ai_cost_table_delete', 'POST', '/file-directory/batch_delete', {
    token: ai_cost_token,
    body: { ids: [ai_cost_table] }
});
await call('ai_cost_logout', 'GET', `/auth/logout?token=${ai_cost_token}`);

// AI rows and tables (#148), against the same stub. Generated rows fit the column types and
// aren't saved until the app inserts them; every row asked for counts against the account's
// monthly allowance (Free: 50, docs/PRICING.md 3.5); demo2 can't generate rows for demo's
// table or read a table demo made from a description.
const gen_count = async (name, id) =>
    (await call(name, 'POST', `/web-file/data_grid_row/${id}?skip=0&limit=1`, { token, body: {} }))
        ?.count;
const gen_status = await call('gen_status', 'GET', '/ai/status', { token });
check(
    'gen_status_rows_and_limits',
    gen_status?.available === true &&
        gen_status?.limits?.max_rows_per_request === 500 &&
        gen_status?.rows?.limit > 0,
    gen_status
);
const gen_used_before = gen_status?.rows?.used ?? 0;
const gen_rows_before = await gen_count('gen_rows_before', file_id);
const gen = await call('gen_rows', 'POST', `/ai/web-file/${file_id}/generate-rows`, {
    token,
    body: { prompt: 'people with ages and join dates', count: 10 }
});
const gen_fits = (v, type) =>
    type === 'number'
        ? typeof v === 'number'
        : type === 'date'
          ? /^\d{4}-\d{2}-\d{2}$/.test(v)
          : typeof v === 'string';
const gen_cols = gen?.columns || [];
check(
    'gen_rows_typed',
    Array.isArray(gen?.rows) &&
        gen.rows.length === 10 &&
        gen_cols.find(c => c.name === 'age')?.type === 'number' &&
        gen.rows.every(
            r =>
                Object.keys(r).length === gen_cols.length &&
                gen_cols.every(c => gen_fits(r[c.field], c.type))
        ),
    gen
);
check(
    'gen_preview_saves_nothing',
    (await gen_count('gen_rows_after', file_id)) === gen_rows_before
);
const gen_status_after = await call('gen_status_after', 'GET', '/ai/status', { token });
check(
    'gen_rows_counted',
    gen_status_after?.rows?.used === gen_used_before + 10 &&
        gen?.usage?.used === gen_used_before + 10,
    gen_status_after
);
await call('gen_insert_rows', 'POST', `/web-file/batch_create/data_grid_row/${file_id}`, {
    token,
    body: gen?.rows || []
});
check(
    'gen_rows_inserted',
    (await gen_count('gen_rows_inserted', file_id)) === gen_rows_before + 10
);

// Asking for rows in Ask AI (#234): the model calls propose_rows, the answer carries the rows
// to review (nothing saved), one question and 4 rows are used, the model is called once
ai_next_tool = 'propose_rows';
ai_next_input = { count: 4, description: 'more people' };
const gen_ask_seen = ai_requests.length;
const gen_ask = await call('gen_ask_rows', 'POST', '/ai/ask', {
    token,
    body: { table: file_id, question: 'add 4 more people' }
});
ai_next_tool = 'run_query';
ai_next_input = {};
check(
    'gen_ask_proposes_rows',
    gen_ask?.proposed?.rows?.length === 4 &&
        gen_ask.proposed.columns.some(c => c.field && c.name === 'age') &&
        gen_ask.api_call === null &&
        gen_ask.rows_usage?.used === gen_used_before + 14 &&
        ai_requests.slice(gen_ask_seen).filter(r => !r.body.output_config?.format).length === 1,
    gen_ask
);
check(
    'gen_ask_saves_nothing',
    (await gen_count('gen_rows_after_ask', file_id)) === gen_rows_before + 10
);

// Reading the account's other tables (#322): asked on smoke_people, the model reads the emails
// of another of demo's tables with run_query's table, then proposes rows with them in
// propose_rows' rows. The answer shows that table's rows and API call and the proposed rows
// (checked against smoke_people's columns, counted as AI rows, not saved). A table of another
// account (demo2's) can't be read: its name is a tool error, and nothing of it comes back.
const xt_name = 'smoke_ai_signups';
const xt_table = await call('ask_other_table_create', 'POST', '/table-template/waitlist', {
    token,
    body: { name: xt_name }
});
const xt_emails = (
    (
        await call('ask_other_table_emails', 'POST', `/api/v1/query?table=${xt_name}`, {
            token: key,
            body: { fields: ['Email'], limit: 3 }
        })
    )?.data || []
).map(r => r.Email);
check('ask_other_table_has_emails', xt_emails.length === 3, xt_emails);
ai_next_script = [
    { name: 'run_query', input: { table: xt_name.toUpperCase(), fields: ['Email'], limit: 3 } },
    {
        name: 'propose_rows',
        input: { description: 'people from the signups', rows: xt_emails.map(e => ({ name: e })) }
    }
];
const xt_seen = ai_requests.length;
const xt_ask = await call('ask_other_table', 'POST', '/ai/ask', {
    token,
    body: { table: file_id, question: `add rows using the emails from ${xt_name}` }
});
ai_next_script = null;
const xt_turns = ai_requests.slice(xt_seen).filter(r => !r.body.output_config?.format);
const xt_result = xt_turns[1]?.body?.messages?.at(-1)?.content?.[0];
const xt_name_field = (xt_ask?.proposed?.columns || []).find(c => c.name === 'name')?.field;
check(
    'ask_other_table_reads_and_proposes',
    xt_turns.length === 2 &&
        String(xt_turns[0].body.system).includes(`"${xt_name}": "Email" (string)`) &&
        xt_result?.is_error !== true &&
        xt_emails.every(e => String(xt_result?.content).includes(e)) &&
        xt_ask?.table === xt_name &&
        JSON.stringify((xt_ask?.rows || []).map(r => r.Email)) === JSON.stringify(xt_emails) &&
        xt_ask?.api_call?.url === `${BASE}/api/v1/query?table=${xt_name}` &&
        xt_ask?.proposed?.rows?.length === 3 &&
        !!xt_name_field &&
        JSON.stringify(xt_ask.proposed.rows.map(r => r[xt_name_field])) ===
            JSON.stringify(xt_emails) &&
        xt_ask?.rows_usage?.used === (gen_ask?.rows_usage?.used ?? -99) + 3,
    { xt_ask, xt_result }
);
check(
    'ask_other_table_saves_nothing',
    (await gen_count('ask_other_table_rows_after', file_id)) === gen_rows_before + 10
);
// demo2's table, by its name: refused like an unknown table
const xt_other = await call('ask_theirs_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const xt_theirs = await call('ask_theirs_table_create', 'POST', '/table-template/waitlist', {
    token: xt_other.token,
    body: { name: 'smoke_ai_theirs' }
});
ai_next_script = [{ name: 'run_query', input: { table: 'smoke_ai_theirs' } }];
const xt_theirs_seen = ai_requests.length;
const xt_theirs_ask = await call('ask_theirs_table', 'POST', '/ai/ask', {
    token,
    body: { table: file_id, question: 'what is in smoke_ai_theirs?' }
});
ai_next_script = null;
const xt_theirs_result = ai_requests.slice(xt_theirs_seen)[1]?.body?.messages?.at(-1)?.content?.[0];
check(
    'ask_theirs_table_refused',
    xt_theirs_result?.is_error === true &&
        String(xt_theirs_result.content).includes('no table named') &&
        !String(xt_theirs_result.content).includes('@example.com') &&
        !String(ai_requests[xt_theirs_seen]?.body?.system).includes('smoke_ai_theirs') &&
        xt_theirs_ask?.api_call === null &&
        xt_theirs_ask?.table === null &&
        Array.isArray(xt_theirs_ask?.rows) &&
        xt_theirs_ask.rows.length === 0,
    { xt_theirs_ask, xt_theirs_result }
);
await call('ask_theirs_table_delete', 'POST', '/file-directory/batch_delete', {
    token: xt_other.token,
    body: { ids: [xt_theirs] }
});
await call('ask_theirs_logout', 'GET', `/auth/logout?token=${xt_other.token}`);
await call('ask_other_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [xt_table] }
});

// Editing rows in Ask AI (#204): the model calls propose_edit (two rows by _id, " (edited)"
// added to their names); the answer previews them before and after, nothing changes until
// apply-edit, a stale preview is skipped, demo2 and API keys can't apply, and undo puts the
// names back. A spec that isn't a known change goes back to the model and changes nothing.
const edit_read = async name =>
    (
        await call(name, 'POST', '/api/v1/query?table=smoke_people', {
            token: key,
            body: { fields: ['name'], sort: ['_id'], limit: 2 }
        })
    )?.data || [];
const edit_rows_before = await edit_read('edit_rows_before');
const edit_ids = edit_rows_before.map(r => r._id);
ai_next_tool = 'propose_edit';
ai_next_input = {
    summary: 'Mark two names as edited',
    filters: [{ column: '_id', op: 'in', value: edit_ids }],
    changes: [{ column: 'name', op: 'concat', parts: [{ column: 'name' }, { text: ' (edited)' }] }]
};
const edit_seen = ai_requests.length;
const edit_ask = await call('edit_ask', 'POST', '/ai/ask', {
    token,
    body: { table: file_id, question: 'add (edited) to the first two names' }
});
const edit_field = edit_ask?.edit?.columns?.[0]?.field;
check(
    'edit_ask_previews',
    edit_ids.length === 2 &&
        edit_ask?.edit?.columns?.length === 1 &&
        edit_ask.edit.columns[0].name === 'name' &&
        edit_ask.edit.matching === 2 &&
        edit_ask.edit.rows.length === 2 &&
        edit_ask.edit.rows.every((r, i) => {
            const was = edit_rows_before[i].name;
            return (
                r._id === edit_ids[i] &&
                (r.before[edit_field] ?? null) === (was ?? null) &&
                r.after[edit_field] === `${was ?? ''} (edited)`.trim()
            );
        }) &&
        edit_ask.api_call === null &&
        String(edit_ask.answer).includes('2 rows') &&
        ai_requests.slice(edit_seen).length === 1 &&
        ai_requests[edit_seen].body.tools?.some(t => t.name === 'propose_edit'),
    edit_ask
);
check(
    'edit_preview_changes_nothing',
    JSON.stringify(await edit_read('edit_rows_after_preview')) === JSON.stringify(edit_rows_before)
);
ai_next_input = { changes: [{ column: 'name', op: 'eval', value: 'process.exit()' }] };
const edit_bad = await call('edit_ask_bad', 'POST', '/ai/ask', {
    token,
    body: { table: file_id, question: 'run this' }
});
const edit_bad_result = ai_requests.at(-1)?.body?.messages?.at(-1)?.content?.[0];
check(
    'edit_ask_bad_spec_refused',
    edit_bad?.edit === null &&
        edit_bad_result?.is_error === true &&
        String(edit_bad?.answer).startsWith('Stub: the query failed'),
    { edit_bad, edit_bad_result }
);
ai_next_tool = 'run_query';
ai_next_input = {};

const edit_rows = edit_ask?.edit?.rows || [];
const edit_path = `/ai/web-file/${file_id}/apply-edit`;
// demo2 can't apply an edit to demo's table, and an API key can't use the route
const edit_other = await call('edit_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
await call('edit_other_apply', 'POST', edit_path, {
    token: edit_other.token,
    body: { rows: edit_rows },
    expectFail: true
});
check(
    'edit_other_apply_refused',
    [401, 403, 404].includes(results.edit_other_apply.status),
    results.edit_other_apply
);
await call('edit_other_logout', 'GET', `/auth/logout?token=${edit_other.token}`);
await call('edit_api_key_apply', 'POST', edit_path, {
    token: key,
    body: { rows: edit_rows },
    expectFail: true
});
for (const [name, body] of [
    ['edit_apply_empty', { rows: [] }],
    [
        'edit_apply_unknown_column',
        { rows: [{ _id: edit_ids[0], before: { zz: 1 }, after: { zz: 2 } }] }
    ],
    ['edit_apply_bad_id', { rows: [{ _id: 'x', before: { a: 1 }, after: { a: 2 } }] }]
]) {
    await call(name, 'POST', edit_path, { token, body, expectFail: true });
    check(`${name}_400`, results[name].status === 400, results[name]);
}
check(
    'edit_refused_changed_nothing',
    JSON.stringify(await edit_read('edit_rows_after_refused')) === JSON.stringify(edit_rows_before)
);

const edit_applied = await call('edit_apply', 'POST', edit_path, {
    token,
    body: { rows: edit_rows }
});
const edit_rows_applied = await edit_read('edit_rows_applied');
check(
    'edit_applied',
    JSON.stringify(edit_applied?.updated) === JSON.stringify(edit_ids) &&
        edit_applied?.skipped?.length === 0 &&
        edit_rows_applied.every(
            (r, i) => r.name === `${edit_rows_before[i].name ?? ''} (edited)`.trim()
        ),
    { edit_applied, edit_rows_applied }
);
// The same preview again: the rows no longer hold its "before", so nothing is written
const edit_again = await call('edit_apply_stale', 'POST', edit_path, {
    token,
    body: { rows: edit_rows }
});
check(
    'edit_stale_skipped',
    edit_again?.updated?.length === 0 && edit_again?.skipped?.length === 2,
    edit_again
);
const edit_undo = await call('edit_undo', 'POST', edit_path, {
    token,
    body: { rows: edit_rows.map(r => ({ _id: r._id, before: r.after, after: r.before })) }
});
check(
    'edit_undone',
    edit_undo?.updated?.length === 2 &&
        JSON.stringify(await edit_read('edit_rows_undone')) === JSON.stringify(edit_rows_before),
    edit_undo
);

// Clean up in Ask AI (#206), on a table of its own with known problems: stray spaces, a
// mailto: email and one that can't be fixed, "waiting" for "Waiting", an exact duplicate, and
// (from the stub, as the model) "Wait-listed" for "Waiting" and rows 0 and 1 as near-duplicates.
// The scan uses one question and changes nothing; the fixes go through apply-edit and
// delete-rows, a stale delete is skipped, demo2 and API keys are refused, and undo
// (apply-edit backwards, restore-rows) puts every row back.
const cu_table = await call('cleanup_table', 'POST', '/table-template/waitlist', {
    token,
    body: { name: 'smoke_cleanup' }
});
const cu_cols = await call(
    'cleanup_cols',
    'POST',
    `/web-file/data_grid_column/${cu_table}?skip=0&limit=50`,
    { token, body: {} }
);
const cu_field = Object.fromEntries((cu_cols?.data || []).map(c => [c.headerName, c.field]));
const cu_row = (email, name, position, status, joined) => ({
    [cu_field.Email]: email,
    [cu_field.Name]: name,
    [cu_field.Position]: position,
    [cu_field.Status]: status,
    [cu_field.Joined]: joined
});
await call('cleanup_rows', 'POST', `/web-file/batch_create/data_grid_row/${cu_table}`, {
    token,
    body: [
        cu_row(' mailto:ana@example.com', 'Ana  Diaz ', 4, 'waiting', '2026-10-10'),
        cu_row('dup@example.com', 'Dup Row', 5, 'Waiting', '2026-10-11'),
        cu_row('dup@example.com', 'Dup Row', 5, 'Waiting', '2026-10-11'),
        cu_row('not-an-email', 'Bad Email', 6, 'Invited', '2026-10-12'),
        cu_row('lee@example.com', 'Lee Wong', 7, 'Wait-listed', '2026-10-13')
    ]
});
// Every row, keyed by column name, in a stable order (restored rows get new ids)
const cu_read = async name =>
    (
        (
            await call(name, 'POST', '/api/v1/query?table=smoke_cleanup', {
                token: key,
                body: { limit: 100 }
            })
        )?.data || []
    )
        .map(({ _id, ...cells }) => JSON.stringify(Object.entries(cells).sort()))
        .sort();
const cu_rows_before = await cu_read('cleanup_rows_before');
const cu_status_before = await call('cleanup_status_before', 'GET', '/ai/status', { token });
ai_next_cleanup = {
    spellings: [{ column: 'Status', canonical: 'Waiting', variants: ['Wait-listed'] }],
    near_duplicates: [{ rows: [0, 1], reason: 'Stub: the same person' }]
};
const cu_seen = ai_requests.length;
const cu_path = `/ai/web-file/${cu_table}`;
const cu_scan = await call('cleanup_scan', 'POST', `${cu_path}/cleanup`, { token, body: {} });
ai_next_cleanup = { spellings: [], near_duplicates: [] };
const cu_problem = kind => (cu_scan?.problems || []).find(p => p.kind === kind);
const cu_calls = ai_requests.slice(cu_seen);
// One whitespace problem per column (Email's comes first), so look through all of them
const cu_name_spaces = (cu_scan?.problems || []).some(
    p =>
        p.kind === 'whitespace' &&
        p.column?.field === cu_field.Name &&
        p.edit?.rows?.some(r => r.after?.[cu_field.Name] === 'Ana Diaz')
);
check(
    'cleanup_scan_problems',
    cu_scan?.scanned === 8 &&
        cu_scan.ai === 'checked' &&
        cu_name_spaces &&
        cu_problem('email')?.count === 2 &&
        cu_problem('email')?.fixable === 1 &&
        cu_problem('email')?.edit?.rows?.[0]?.after?.[cu_field.Email] === 'ana@example.com' &&
        cu_problem('case')?.edit?.rows?.length === 1 &&
        cu_problem('duplicate')?.delete?.rows?.length === 1 &&
        // The date column's cell, sent as an ISO string
        /^2026-10-11T00:00:00(\.000)?Z$/.test(
            cu_problem('duplicate')?.delete?.rows?.[0]?.before?.[cu_field.Joined]
        ) &&
        cu_problem('spelling')?.source === 'ai' &&
        cu_problem('spelling')?.edit?.rows?.[0]?.after?.[cu_field.Status] === 'Waiting' &&
        cu_problem('near_duplicate')?.delete?.rows?.length === 1,
    cu_scan
);
check(
    'cleanup_scan_one_model_call',
    cu_calls.length === 1 &&
        !!cu_calls[0].body.output_config?.format?.schema?.properties?.spellings &&
        String(cu_calls[0].body.messages?.[0]?.content).includes('Wait-listed') &&
        cu_scan?.usage?.used === (cu_status_before?.usage?.used ?? 0) + 1,
    { calls: cu_calls.length, usage: cu_scan?.usage }
);
check(
    'cleanup_scan_changes_nothing',
    JSON.stringify(await cu_read('cleanup_rows_after_scan')) === JSON.stringify(cu_rows_before)
);

// The fixes as the app applies them: every edit (a cell's last fix wins) and the exact
// duplicate; not the near-duplicate
const cu_deletes = cu_problem('duplicate')?.delete?.rows || [];
const cu_deleting = new Set(cu_deletes.map(r => r._id));
const cu_merged = new Map();
for (const p of cu_scan?.problems || []) {
    for (const r of p.edit?.rows || []) {
        if (cu_deleting.has(r._id)) continue;
        const m = cu_merged.get(r._id) || { _id: r._id, before: {}, after: {} };
        for (const f of Object.keys(r.after)) {
            if (!(f in m.before)) m.before[f] = r.before[f];
            m.after[f] = r.after[f];
        }
        cu_merged.set(r._id, m);
    }
}
const cu_edits = [...cu_merged.values()];
const cu_delete_body = { rows: cu_deletes.map(r => ({ _id: r._id, before: r.before })) };

// demo2 can't scan, delete or restore in demo's table; an API key can't use the routes
const cu_other = await call('cleanup_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const cu_other_seen = ai_requests.length;
for (const [name, path, body] of [
    ['cleanup_other_scan', 'cleanup', {}],
    ['cleanup_other_delete', 'delete-rows', cu_delete_body],
    ['cleanup_other_restore', 'restore-rows', { rows: [{ [cu_field.Name]: 'pwned' }] }]
]) {
    await call(name, 'POST', `${cu_path}/${path}`, {
        token: cu_other.token,
        body,
        expectFail: true
    });
    check(`${name}_refused`, [401, 403, 404].includes(results[name].status), results[name]);
    await call(`${name}_api_key`, 'POST', `${cu_path}/${path}`, {
        token: key,
        body,
        expectFail: true
    });
}
await call('cleanup_other_logout', 'GET', `/auth/logout?token=${cu_other.token}`);
check('cleanup_other_never_called_model', ai_requests.length === cu_other_seen);
for (const [name, path, body] of [
    ['cleanup_delete_empty', 'delete-rows', { rows: [] }],
    ['cleanup_delete_bad_id', 'delete-rows', { rows: [{ _id: 'x', before: { a: 'y' } }] }],
    ['cleanup_restore_unknown_column', 'restore-rows', { rows: [{ zz: 'x' }] }]
]) {
    await call(name, 'POST', `${cu_path}/${path}`, { token, body, expectFail: true });
    check(`${name}_400`, results[name].status === 400, results[name]);
}
check(
    'cleanup_refused_changed_nothing',
    JSON.stringify(await cu_read('cleanup_rows_after_refused')) === JSON.stringify(cu_rows_before)
);

const cu_deleted = await call('cleanup_delete', 'POST', `${cu_path}/delete-rows`, {
    token,
    body: cu_delete_body
});
const cu_fixed = await call('cleanup_apply', 'POST', `${cu_path}/apply-edit`, {
    token,
    body: { rows: cu_edits }
});
const cu_rows_fixed = await cu_read('cleanup_rows_fixed');
const cu_text = cu_rows_fixed.join('\n');
check(
    'cleanup_applied',
    cu_deleted?.deleted?.length === 1 &&
        cu_fixed?.updated?.length === cu_edits.length &&
        cu_rows_fixed.length === cu_rows_before.length - 1 &&
        cu_text.includes('"Ana Diaz"') &&
        cu_text.includes('"ana@example.com"') &&
        !cu_text.includes('"waiting"') &&
        !cu_text.includes('Wait-listed') &&
        cu_text.includes('"not-an-email"') &&
        cu_rows_fixed.filter(r => r.includes('"Dup Row"')).length === 1,
    { cu_deleted, cu_fixed, cu_rows_fixed }
);
const cu_stale = await call('cleanup_delete_stale', 'POST', `${cu_path}/delete-rows`, {
    token,
    body: cu_delete_body
});
check(
    'cleanup_delete_stale_skipped',
    cu_stale?.deleted?.length === 0 && cu_stale?.skipped?.length === 1,
    cu_stale
);
await call('cleanup_undo_edit', 'POST', `${cu_path}/apply-edit`, {
    token,
    body: { rows: cu_edits.map(r => ({ _id: r._id, before: r.after, after: r.before })) }
});
const cu_restored = await call('cleanup_restore', 'POST', `${cu_path}/restore-rows`, {
    token,
    body: { rows: cu_deletes.map(r => r.before) }
});
check(
    'cleanup_undone',
    cu_restored?.restored === 1 &&
        JSON.stringify(await cu_read('cleanup_rows_undone')) === JSON.stringify(cu_rows_before),
    cu_restored
);
await call('cleanup_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [cu_table] }
});
for (const [name, body] of [
    ['gen_rows_over_request_cap', { prompt: 'x', count: 501 }],
    ['gen_rows_no_prompt', { prompt: ' ', count: 5 }],
    ['gen_rows_bad_count', { prompt: 'x', count: 'many' }]
]) {
    await call(name, 'POST', `/ai/web-file/${file_id}/generate-rows`, {
        token,
        body,
        expectFail: true
    });
    check(`${name}_400`, results[name].status === 400, results[name]);
}
// More than the month's allowance (demo3, Free: 50 rows): 429, nothing asked of the model
const gen_free = await call('gen_free_login', 'POST', '/auth/login', {
    body: { email: 'demo3@invokedb.com', password: 'password' }
});
const gen_free_token = gen_free.token;
const gen_free_status = await call('gen_free_status', 'GET', '/ai/status', {
    token: gen_free_token
});
check('gen_free_rows_50', gen_free_status?.rows?.limit === 50, gen_free_status);
const gen_free_table = await call('gen_free_table', 'POST', '/table-template/waitlist', {
    token: gen_free_token,
    body: { name: 'smoke_ai_gen_free' }
});
const gen_seen = ai_requests.length;
await call('gen_rows_over_allowance', 'POST', `/ai/web-file/${gen_free_table}/generate-rows`, {
    token: gen_free_token,
    body: { prompt: 'x', count: 60 },
    expectFail: true
});
check(
    'gen_rows_over_allowance_429',
    results.gen_rows_over_allowance.status === 429 && ai_requests.length === gen_seen,
    results.gen_rows_over_allowance
);
await call('gen_free_table_delete', 'POST', '/file-directory/batch_delete', {
    token: gen_free_token,
    body: { ids: [gen_free_table] }
});
await call('gen_free_logout', 'GET', `/auth/logout?token=${gen_free_token}`);
await call('gen_rows_no_table', 'POST', '/ai/web-file/99999999/generate-rows', {
    token,
    body: { prompt: 'x', count: 1 },
    expectFail: true
});

const gen_other = await call('gen_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const gen_token2 = gen_other.token;
const gen_other_before = await call('gen_other_status', 'GET', '/ai/status', { token: gen_token2 });
await call('gen_other_generate', 'POST', `/ai/web-file/${file_id}/generate-rows`, {
    token: gen_token2,
    body: { prompt: 'x', count: 5 },
    expectFail: true
});
check(
    'gen_other_generate_refused',
    [401, 403, 404].includes(results.gen_other_generate.status),
    results.gen_other_generate
);
const gen_other_after = await call('gen_other_status_after', 'GET', '/ai/status', {
    token: gen_token2
});
check('gen_usage_per_account', gen_other_after?.rows?.used === gen_other_before?.rows?.used, {
    gen_other_before,
    gen_other_after
});

const gen_preview = await call('gen_table_preview', 'POST', '/ai/table/preview', {
    token,
    body: { description: 'a CRM for a dog groomer', row_count: 3 }
});
check(
    'gen_table_preview_shape',
    typeof gen_preview?.table_name === 'string' &&
        Array.isArray(gen_preview?.columns) &&
        gen_preview.columns.length > 0 &&
        gen_preview.columns.every(c => ['string', 'number', 'date'].includes(c.type)) &&
        Array.isArray(gen_preview?.rows) &&
        gen_preview.rows.length === 3 &&
        // 10 generated, 4 asked for, 3 proposed from another table (#322), 3 here
        gen_preview?.usage?.used === gen_used_before + 20,
    gen_preview
);

// A new table from a description that reads the account's tables (#324): the design call
// lists demo's tables; the model reads one with run_query and answers propose_table with rows
// built from its emails, which the preview holds (a column it didn't fill stays empty). Only the
// rows kept count, not the 20 asked for, and the read costs none. A table of demo2's can't be
// read (a tool error, nothing of it sent), and with no rows given they're generated as before.
const tfd_name = 'smoke_ai_crm_contacts';
const tfd_table = await call('table_from_tables_source', 'POST', '/table-template/waitlist', {
    token,
    body: { name: tfd_name }
});
const tfd_emails = (
    (
        await call('table_from_tables_emails', 'POST', `/api/v1/query?table=${tfd_name}`, {
            token: key,
            body: { fields: ['Email'], limit: 3 }
        })
    )?.data || []
).map(r => r.Email);
check('table_from_tables_has_emails', tfd_emails.length === 3, tfd_emails);
ai_next_script = [
    { name: 'run_query', input: { table: tfd_name, fields: ['Email'], limit: 3 } },
    {
        name: 'propose_table',
        input: {
            table_name: 'follow_ups',
            columns: [
                { name: 'Email', type: 'string' },
                { name: 'Follow up', type: 'date' }
            ],
            rows: tfd_emails.map(e => ({ Email: e }))
        }
    }
];
const tfd_seen = ai_requests.length;
const tfd = await call('table_from_tables_preview', 'POST', '/ai/table/preview', {
    token,
    body: { description: `A table of follow-ups for the emails in ${tfd_name}`, row_count: 20 }
});
ai_next_script = null;
const tfd_turns = ai_requests.slice(tfd_seen);
const tfd_result = tfd_turns[1]?.body?.messages
    ?.at(-1)
    ?.content?.find?.(c => c.type === 'tool_result');
check(
    'table_from_tables_copies_rows',
    tfd_turns.length === 2 &&
        tfd_turns.every(r => !r.body.output_config?.format) &&
        String(tfd_turns[0].body.system).includes(`"${tfd_name}": "Email" (string)`) &&
        tfd_result?.is_error !== true &&
        tfd_emails.every(e => String(tfd_result?.content).includes(e)) &&
        tfd?.table_name === 'follow_ups' &&
        JSON.stringify((tfd?.rows || []).map(r => r.Email)) === JSON.stringify(tfd_emails) &&
        tfd.rows.every(r => r['Follow up'] === null) &&
        JSON.stringify(tfd?.read) === JSON.stringify([tfd_name]) &&
        tfd?.usage?.used === (gen_preview?.usage?.used ?? -99) + 3,
    { tfd, tfd_result }
);
const tfd_theirs_name = 'smoke_ai_theirs_contacts';
const tfd_theirs = await call(
    'table_from_tables_theirs_create',
    'POST',
    '/table-template/waitlist',
    {
        token: gen_token2,
        body: { name: tfd_theirs_name }
    }
);
ai_next_script = [{ name: 'run_query', input: { table: tfd_theirs_name } }];
const tfd_theirs_seen = ai_requests.length;
const tfd_t = await call('table_from_tables_theirs', 'POST', '/ai/table/preview', {
    token,
    body: { description: `follow-ups for the emails in ${tfd_theirs_name}`, row_count: 2 }
});
ai_next_script = null;
const tfd_t_turns = ai_requests.slice(tfd_theirs_seen);
const tfd_t_result = tfd_t_turns[1]?.body?.messages
    ?.at(-1)
    ?.content?.find?.(c => c.type === 'tool_result');
check(
    'table_from_tables_theirs_refused',
    tfd_t_result?.is_error === true &&
        String(tfd_t_result.content).includes('no table named') &&
        !String(tfd_t_turns[0]?.body?.system).includes(tfd_theirs_name) &&
        !JSON.stringify(tfd_t_turns.map(r => r.body)).includes('@example') &&
        Array.isArray(tfd_t?.read) &&
        tfd_t.read.length === 0 &&
        tfd_t?.rows?.length === 2 &&
        tfd_t_turns.filter(r => r.body.output_config?.format).length === 1 &&
        tfd_t?.usage?.used === (tfd?.usage?.used ?? -99) + 2,
    { tfd_t, tfd_t_result }
);
await call('table_from_tables_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [tfd_table] }
});
await call('table_from_tables_theirs_delete', 'POST', '/file-directory/batch_delete', {
    token: gen_token2,
    body: { ids: [tfd_theirs] }
});
const gen_table = await call('gen_table_create', 'POST', '/ai/table', {
    token,
    body: {
        table_name: 'smoke_ai_table',
        columns: gen_preview?.columns,
        rows: gen_preview?.rows
    }
});
const gen_table_cols = await call(
    'gen_table_cols',
    'POST',
    `/web-file/data_grid_column/${gen_table}?skip=0&limit=50`,
    { token, body: {} }
);
check(
    'gen_table_columns_match',
    JSON.stringify((gen_table_cols.data || []).map(c => [c.headerName, c.col_type])) ===
        JSON.stringify((gen_preview?.columns || []).map(c => [c.name, c.type])),
    gen_table_cols
);
const gen_table_rows = await call(
    'gen_table_rows',
    'POST',
    `/web-file/data_grid_row/${gen_table}?skip=0&limit=50`,
    { token, body: {} }
);
const gen_num_col = (gen_table_cols.data || []).find(c => c.col_type === 'number');
check(
    'gen_table_rows_typed',
    gen_table_rows?.count === 3 &&
        (!gen_num_col ||
            gen_table_rows.data.every(
                r =>
                    [null, undefined].includes(r[gen_num_col.field]) ||
                    typeof r[gen_num_col.field] === 'number'
            )),
    gen_table_rows
);
await call('gen_table_create_bad', 'POST', '/ai/table', {
    token,
    body: { table_name: 'smoke ai bad', columns: [{ name: 'A', type: 'link' }] },
    expectFail: true
});
check('gen_table_create_bad_400', results.gen_table_create_bad.status === 400);
await call('gen_other_table_rows', 'POST', `/web-file/data_grid_row/${gen_table}?skip=0&limit=1`, {
    token: gen_token2,
    body: {},
    expectFail: true
});
const gen_other_files = await call('gen_other_files', 'GET', '/file-directory', {
    token: gen_token2
});
check(
    'gen_table_not_in_other_account',
    Array.isArray(gen_other_files) && !gen_other_files.some(d => d.id === gen_table),
    gen_other_files
);
await call('gen_other_logout', 'GET', `/auth/logout?token=${gen_token2}`);
await call('gen_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [gen_table] }
});

// Pasted text in Ask AI (#207): one structured-output call (the stub answers the rows the test
// sets), rows of the column types to review, a made-up name dropped, nothing saved, one question
// and the rows made counted; bad text, demo2 and an API key are refused with no model call.
const imp_field = name => gen_cols.find(c => c.name === name)?.field;
const imp_text = 'Hi! Two new sign-ups:\nDora Smith (age 52)\nEvan Jones, 19\nThanks';
ai_next_import = {
    rows: [
        { [imp_field('name')]: 'Dora Smith', [imp_field('age')]: 52 },
        { [imp_field('name')]: 'Evan Jones', [imp_field('age')]: '19' },
        { [imp_field('name')]: 'Made Up Person', [imp_field('age')]: null }
    ]
};
const imp_status = await call('import_status_before', 'GET', '/ai/status', { token });
check(
    'import_status_limits',
    imp_status?.limits?.max_import_text_length === 20000 &&
        imp_status?.limits?.max_import_rows === 200,
    imp_status?.limits
);
const imp_rows_before = await gen_count('import_rows_before', file_id);
const imp_seen = ai_requests.length;
const imp = await call('import_text', 'POST', `/ai/web-file/${file_id}/import-text`, {
    token,
    body: { text: imp_text }
});
const imp_calls = ai_requests.slice(imp_seen);
check(
    'import_text_rows',
    imp?.proposed?.rows?.length === 2 &&
        imp.proposed.rows[0][imp_field('name')] === 'Dora Smith' &&
        imp.proposed.rows[1][imp_field('age')] === 19 &&
        imp.proposed.rows.every(r => Object.keys(r).length === imp.proposed.columns.length) &&
        imp.capped === false &&
        typeof imp.answer === 'string',
    imp
);
check(
    'import_text_one_model_call',
    imp_calls.length === 1 &&
        imp_calls[0].body.model === 'claude-haiku-5-5' &&
        imp_calls[0].body.output_config?.effort === 'low' &&
        !!imp_calls[0].body.output_config?.format?.schema?.properties?.rows &&
        String(imp_calls[0].body.messages?.[0]?.content).includes('Evan Jones, 19'),
    imp_calls.map(r => r.body.output_config)
);
check(
    'import_text_counted',
    imp?.usage?.used === imp_status?.usage?.used + 1 &&
        imp?.rows_usage?.used === imp_status?.rows?.used + 2,
    { before: imp_status, usage: imp?.usage, rows_usage: imp?.rows_usage }
);
check(
    'import_text_saves_nothing',
    (await gen_count('import_rows_after', file_id)) === imp_rows_before
);
const imp_bad_seen = ai_requests.length;
for (const [name, body] of [
    ['import_text_empty', { text: '  ' }],
    ['import_text_too_long', { text: 'x'.repeat(20001) }],
    ['import_text_not_text', { text: 5 }]
]) {
    await call(name, 'POST', `/ai/web-file/${file_id}/import-text`, {
        token,
        body,
        expectFail: true
    });
    check(`${name}_400`, results[name].status === 400, results[name]);
}
await call('import_text_no_table', 'POST', '/ai/web-file/99999999/import-text', {
    token,
    body: { text: imp_text },
    expectFail: true
});
check(
    'import_text_no_table_refused',
    [403, 404].includes(results.import_text_no_table.status),
    results.import_text_no_table
);
await call('import_text_api_key', 'POST', `/ai/web-file/${file_id}/import-text`, {
    token: key,
    body: { text: imp_text },
    expectFail: true
});
check(
    'import_text_api_key_refused',
    [401, 403].includes(results.import_text_api_key.status),
    results.import_text_api_key
);
const imp_other = await call('import_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const imp_other_before = await call('import_other_status', 'GET', '/ai/status', {
    token: imp_other.token
});
await call('import_text_other', 'POST', `/ai/web-file/${file_id}/import-text`, {
    token: imp_other.token,
    body: { text: imp_text },
    expectFail: true
});
check(
    'import_text_other_refused',
    [401, 403, 404].includes(results.import_text_other.status),
    results.import_text_other
);
const imp_other_after = await call('import_other_status_after', 'GET', '/ai/status', {
    token: imp_other.token
});
check(
    'import_text_other_uncounted',
    imp_other_after?.usage?.used === imp_other_before?.usage?.used &&
        imp_other_after?.rows?.used === imp_other_before?.rows?.used,
    { imp_other_before, imp_other_after }
);
await call('import_other_logout', 'GET', `/auth/logout?token=${imp_other.token}`);
check('import_text_refused_never_called_model', ai_requests.length === imp_bad_seen);
ai_next_import = { rows: [] };

// AI columns (#205): a column filled per row from a prompt over other columns, by the
// processor (every few seconds). Bad settings are 400s; the estimate counts the rows a fill
// uses; a fill computes every row (one AI row each, through the stub); editing a row's input
// recomputes only that row; the API never shows the rows' AI state; demo2 and API keys can't
// see or use another account's AI columns; deleting the table deletes them.
const aic_table = await call('ai_column_table', 'POST', '/table-template/tasks', {
    token,
    body: { name: 'smoke_ai_column' }
});
const aic_cols = await call(
    'ai_column_table_cols',
    'POST',
    `/web-file/data_grid_column/${aic_table}?skip=0&limit=50`,
    { token, body: {} }
);
const aic_col = name => (aic_cols?.data || []).find(c => c.headerName === name)?.field;
const [aic_task, aic_priority] = [aic_col('Task'), aic_col('Priority')];
check('ai_column_table_columns', !!(aic_task && aic_priority), aic_cols);
const aic_rows = async name =>
    (
        await call(name, 'POST', `/web-file/data_grid_row/${aic_table}?skip=0&limit=100`, {
            token,
            body: {}
        })
    )?.data || [];
const aic_before = await aic_rows('ai_column_rows_before');
const aic_body = {
    table: aic_table,
    field: aic_priority,
    prompt: 'Rate how urgent the task is',
    inputs: [aic_task]
};
const aic_bad = {
    ai_column_save_itself: { ...aic_body, inputs: [aic_priority] },
    ai_column_save_unknown_column: { ...aic_body, field: 'zz9' },
    ai_column_save_no_prompt: { ...aic_body, prompt: '  ' },
    ai_column_save_no_inputs: { ...aic_body, inputs: [] }
};
for (const [name, body] of Object.entries(aic_bad)) {
    await call(name, 'PUT', '/ai-column', { token, body, expectFail: true });
    check(`${name}_400`, results[name]?.status === 400, results[name]);
}
const aic_saved = await call('ai_column_save', 'PUT', '/ai-column', { token, body: aic_body });
check(
    'ai_column_saved_not_filling',
    aic_saved?.column?.field === aic_priority && aic_saved.column.auto === false,
    aic_saved
);
const aic_list = await call('ai_column_list', 'GET', `/ai-column?table=${aic_table}`, { token });
check(
    'ai_column_listed',
    aic_list?.columns?.length === 1 && aic_list.columns[0].inputs[0] === aic_task,
    aic_list
);
const aic_with_task = aic_before.filter(r => r[aic_task]);
const aic_estimate = await call(
    'ai_column_estimate',
    'GET',
    `/ai-column/${aic_table}/${aic_priority}/estimate`,
    { token }
);
check(
    'ai_column_estimate_counts_rows',
    aic_with_task.length > 0 &&
        aic_estimate?.rows === aic_with_task.length &&
        aic_estimate.available === true &&
        aic_estimate.left >= aic_estimate.rows,
    { aic_estimate, rows: aic_before.length }
);

// demo2 and an API key can't see, change, fill or remove demo's AI columns
const aic_other = await call('ai_column_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const aic_otoken = aic_other.token;
const aic_refused = [
    ['ai_column_other_list', 'GET', `/ai-column?table=${aic_table}`],
    ['ai_column_other_save', 'PUT', '/ai-column', aic_body],
    ['ai_column_other_estimate', 'GET', `/ai-column/${aic_table}/${aic_priority}/estimate`],
    ['ai_column_other_fill', 'POST', `/ai-column/${aic_table}/${aic_priority}/fill`],
    ['ai_column_other_delete', 'DELETE', `/ai-column/${aic_table}/${aic_priority}`]
];
for (const [name, method, path, body] of aic_refused) {
    await call(name, method, path, { token: aic_otoken, body, expectFail: true });
    check(`${name}_refused`, [401, 403, 404].includes(results[name]?.status), results[name]);
}
await call('ai_column_other_logout', 'GET', `/auth/logout?token=${aic_otoken}`);
await call('ai_column_api_key', 'GET', `/ai-column?table=${aic_table}`, {
    token: key,
    expectFail: true
});
check(
    'ai_column_api_key_refused',
    [401, 403].includes(results.ai_column_api_key?.status),
    results.ai_column_api_key
);
await call('ai_column_no_token', 'GET', `/ai-column?table=${aic_table}`, { expectFail: true });
await call('ai_column_list_no_table', 'GET', '/ai-column', { token, expectFail: true });
check('ai_column_list_no_table_400', results.ai_column_list_no_table?.status === 400);
const aic_still = await call('ai_column_list_unchanged', 'GET', `/ai-column?table=${aic_table}`, {
    token
});
check(
    'ai_column_unchanged_by_other',
    aic_still?.columns?.length === 1 &&
        aic_still.columns[0].auto === false &&
        aic_still.columns[0].prompt === aic_body.prompt,
    aic_still
);

// Waits (up to 40 s) for the processor to fill the cells `want` says are done
const aic_wait = async (name, want) => {
    let rows = [];
    for (let i = 0; i < 40; i++) {
        rows = await aic_rows(`${name}_${i}`);
        if (want(rows)) return rows;
        await sleep(1000);
    }
    return rows;
};
const aic_rows_used = async name => (await call(name, 'GET', '/ai/status', { token }))?.rows?.used;
const aic_used_before = await aic_rows_used('ai_column_usage_before');
const aic_seen = ai_requests.length;
const aic_fill = await call(
    'ai_column_fill',
    'POST',
    `/ai-column/${aic_table}/${aic_priority}/fill`,
    {
        token
    }
);
check('ai_column_fill_started', aic_fill?.column?.auto === true, aic_fill);
const aic_filled = await aic_wait('ai_column_rows_filled', rows =>
    rows.filter(r => r[aic_task]).every(r => r[aic_priority] === `AI: ${r[aic_task]}`)
);
const aic_calls = ai_requests
    .slice(aic_seen)
    .filter(r => r.body?.output_config?.format?.schema?.properties?.values);
check(
    'ai_column_filled_every_row',
    aic_filled.filter(r => r[aic_task]).length === aic_with_task.length &&
        aic_filled
            .filter(r => r[aic_task])
            .every(r => r[aic_priority] === `AI: ${r[aic_task]}` && r._ai?.[aic_priority]?.h) &&
        aic_calls.length >= 1 &&
        aic_calls.every(
            r => r.body.model === 'claude-haiku-5-5' && r.body.output_config.effort === 'low'
        ),
    { rows: aic_filled.slice(0, 3), calls: aic_calls.length }
);
// A moment for the processor to charge the last call
await sleep(500);
const aic_used_after = await aic_rows_used('ai_column_usage_after');
check(
    'ai_column_counts_one_ai_row_per_cell',
    aic_used_after === aic_used_before + aic_with_task.length,
    { aic_used_before, aic_used_after, rows: aic_with_task.length }
);
// The API shows the column's values, never the rows' AI state
const aic_api = await call(
    'ai_column_api_rows',
    'GET',
    `/api/v1/get?table=smoke_ai_column&skip=0&limit=50`,
    {
        token: key
    }
);
check(
    'ai_column_api_hides_state',
    (aic_api?.data || []).length > 0 &&
        aic_api.data.every(r => !('_ai' in r)) &&
        aic_api.data.some(r => String(r.Priority).startsWith('AI: ')),
    aic_api
);

// Editing a row's input recomputes that row only (the grid sends the row's AI state back with
// it; that's ignored)
const aic_edit_row = aic_filled.find(r => r[aic_task]);
const aic_edit_seen = ai_requests.length;
await call('ai_column_edit_input', 'PUT', `/web-file/batch_update/data_grid_row/${aic_table}`, {
    token,
    body: [
        { ...aic_edit_row, [aic_task]: 'Smoke edited task', _ai: { [aic_priority]: { h: 'x' } } }
    ]
});
const aic_refreshed = await aic_wait('ai_column_rows_refreshed', rows =>
    rows.some(r => r._id === aic_edit_row._id && r[aic_priority] === 'AI: Smoke edited task')
);
const aic_edit_calls = ai_requests
    .slice(aic_edit_seen)
    .filter(r => r.body?.output_config?.format?.schema?.properties?.values);
check(
    'ai_column_refreshed_on_edit',
    aic_refreshed.some(
        r => r._id === aic_edit_row._id && r[aic_priority] === 'AI: Smoke edited task'
    ) &&
        aic_edit_calls.length === 1 &&
        (String(aic_edit_calls[0].body.messages[0].content).match(/^\d+: /gm) || []).length === 1,
    { calls: aic_edit_calls.length, row: aic_refreshed.find(r => r._id === aic_edit_row._id) }
);
const aic_used_edit = await aic_rows_used('ai_column_usage_after_edit');
check('ai_column_edit_counts_one_row', aic_used_edit === aic_used_after + 1, {
    aic_used_after,
    aic_used_edit
});

// Changing the prompt needs a new fill (its cost wasn't confirmed)
const aic_changed = await call('ai_column_change_prompt', 'PUT', '/ai-column', {
    token,
    body: { ...aic_body, prompt: 'Something else' }
});
check('ai_column_change_stops_filling', aic_changed?.column?.auto === false, aic_changed);

// Removing it makes it an ordinary column with its values; deleting the table deletes it
await call('ai_column_delete', 'DELETE', `/ai-column/${aic_table}/${aic_priority}`, { token });
const aic_gone = await call('ai_column_list_after_delete', 'GET', `/ai-column?table=${aic_table}`, {
    token
});
check('ai_column_deleted', aic_gone?.columns?.length === 0, aic_gone);
await call('ai_column_save_again', 'PUT', '/ai-column', { token, body: aic_body });
await call('ai_column_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [aic_table] }
});
await call('ai_column_list_table_gone', 'GET', `/ai-column?table=${aic_table}`, {
    token,
    expectFail: true
});
ai_stub.close();

const nameCol = cols.data && cols.data.find(c => c.headerName === 'joined');
if (nameCol) {
    await call('delete_col', 'POST', `/web-file/batch_delete/data_grid_column/${file_id}`, {
        token,
        body: [nameCol._id]
    });
}
// Email verification on signup (#132). The demo accounts (made before it) count as verified.
check(
    'demo_account_verified',
    me && me.email_verified === true && typeof me.api_key === 'string' && me.api_key.length > 0,
    me && { email_verified: me.email_verified, has_key: !!me.api_key }
);
// A new address each run (the signup rate limit counts per email)
const signup_email = `smoke-${crypto.randomUUID().slice(0, 8)}@example.com`;
const signup_password = 'Sm0ke-pass!';
const signup_new = await call('signup_new', 'POST', '/auth/create-account', {
    body: { email: signup_email, password: signup_password }
});
// The same address again, in other case: it has an account now, and the answer must not say so
const signup_taken = await call('signup_existing', 'POST', '/auth/create-account', {
    body: { email: signup_email.toUpperCase(), password: 'Other-pass1!' }
});
check(
    'signup_same_answer_for_existing_email',
    JSON.stringify(signup_new) === JSON.stringify(signup_taken) &&
        results.signup_new.status === results.signup_existing.status,
    { signup_new, signup_taken }
);
await call('signup_bad_password', 'POST', '/auth/create-account', {
    body: { email: `x${signup_email}`, password: 'short' },
    expectFail: true
});
// An unverified account can sign in and look around...
const unv_session = await call('unverified_login', 'POST', '/auth/login', {
    body: { email: signup_email, password: signup_password }
});
await call('signup_existing_kept_password', 'POST', '/auth/login', {
    body: { email: signup_email, password: 'Other-pass1!' },
    expectFail: true
});
const unv_token = unv_session?.token;
const unv_me = await call('unverified_authorize', 'GET', `/auth/authorize?token=${unv_token}`);
check(
    'unverified_no_api_key',
    unv_me && unv_me.email_verified === false && !unv_me.api_key,
    unv_me && { email_verified: unv_me.email_verified, has_key: !!unv_me.api_key }
);
await call('unverified_list', 'GET', '/file-directory', { token: unv_token });
await call('unverified_templates', 'GET', '/table-template', { token: unv_token });
// ...but can't make a table, by any route (a folder is fine)
await call('unverified_create_table', 'POST', '/file-directory', {
    token: unv_token,
    body: { account_id: unv_me?.id, name: 'smoke_unv', type: 'file', web_file_type: 'data-grid' },
    expectFail: true
});
check('unverified_create_table_403', results.unverified_create_table.status === 403);
await call('unverified_template_create', 'POST', '/table-template/tasks', {
    token: unv_token,
    body: { name: 'smoke_unv_tasks' },
    expectFail: true
});
await call('unverified_url_import', 'POST', '/url-import', {
    token: unv_token,
    body: {
        new_name: 'smoke_unv_url',
        url: `${RAW}/examples/data/todo.csv`
    },
    expectFail: true
});
// ...nor spend AI calls (they cost money): no allowance, and the routes answer 403
const unv_ai = await call('unverified_ai_status', 'GET', '/ai/status', { token: unv_token });
check(
    'unverified_ai_none',
    unv_ai?.usage?.verified === false && unv_ai?.usage?.limit === 0 && unv_ai?.rows?.limit === 0,
    unv_ai
);
await call('unverified_ai_preview', 'POST', '/ai/table/preview', {
    token: unv_token,
    body: { description: 'a list of books', row_count: 3 },
    expectFail: true
});
check('unverified_ai_preview_403', results.unverified_ai_preview.status === 403);
// ...nor make an API key (#138 keys need a verified email too)
await call('unverified_api_key_create', 'POST', '/api-key', {
    token: unv_token,
    body: { name: 'smoke', access: 'read' },
    expectFail: true
});
check('unverified_api_key_create_403', results.unverified_api_key_create.status === 403);
const unv_dir = await call('unverified_create_folder', 'POST', '/file-directory', {
    token: unv_token,
    body: { account_id: unv_me?.id, name: 'smoke_unv_dir', type: 'dir' }
});
const unv_list = await call('unverified_list_after', 'GET', '/file-directory', {
    token: unv_token
});
check(
    'unverified_made_no_table',
    Array.isArray(unv_list) && !unv_list.some(d => d.type === 'file'),
    unv_list
);
const unv_onboarding = await call('unverified_onboarding', 'GET', '/onboarding', {
    token: unv_token
});
check(
    'unverified_onboarding_no_key',
    !JSON.stringify(unv_onboarding ?? '').includes('Bearer '),
    unv_onboarding
);
const resent = await call('unverified_resend', 'POST', '/auth/resend-verification', {
    token: unv_token
});
check('unverified_resend_sent', resent && resent.sent === true, resent);
await call('verified_resend_noop', 'POST', '/auth/resend-verification', { token });
check(
    'verified_resend_sent_nothing',
    results.verified_resend_noop.data?.email_verified === true &&
        !results.verified_resend_noop.data?.sent,
    results.verified_resend_noop.data
);
await call('resend_no_session', 'POST', '/auth/resend-verification', { expectFail: true });
await call('resend_api_key', 'POST', '/auth/resend-verification', {
    token: me.api_key,
    expectFail: true
});
await call('verify_email_unknown', 'GET', `/auth/verify-email?token=${crypto.randomUUID()}`, {
    expectFail: true
});
await call('verify_email_not_uuid', 'GET', '/auth/verify-email?token=nope', { expectFail: true });
await call('verify_email_no_token', 'GET', '/auth/verify-email', { expectFail: true });
// Billing through Stripe (#129). smoke-env.sh points the backend at a stub of the Stripe API on
// 127.0.0.1:8196 and sets a made-up webhook secret, so the test signs its own events. The stub
// answers with the subscriptions the test sets, the way Stripe would after a Checkout, a
// failed payment or a cancel; the webhook makes the backend read them, and GET /usage shows
// the plan. Runs on the new (unverified) account, which is on Free and has no caps lifted.
const STRIPE_WEBHOOK_SECRET = 'whsec_smoke_secret';
const stripe_stub = {
    // customer id -> its subscriptions
    subs: {},
    customers: [],
    checkouts: [],
    cancelled: [],
    expired: []
};
function stripe_list(data) {
    return { object: 'list', data, has_more: false, url: '/v1/x' };
}
const stripe_server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const params = new URLSearchParams(req.method === 'GET' ? url.search : raw);
        const p = url.pathname;
        let body = null;
        let status = 200;
        if (req.method === 'GET' && p === '/v1/subscriptions') {
            body = stripe_list(stripe_stub.subs[params.get('customer')] || []);
        } else if (req.method === 'DELETE' && p.startsWith('/v1/subscriptions/')) {
            const id = p.split('/').pop();
            for (const list of Object.values(stripe_stub.subs)) {
                for (const s of list) if (s.id === id) s.status = 'canceled';
            }
            stripe_stub.cancelled.push(id);
            body = { id, object: 'subscription', status: 'canceled' };
        } else if (req.method === 'POST' && p === '/v1/customers') {
            const id = `cus_smoke_${stripe_stub.customers.length + 1}`;
            const c = {
                id,
                object: 'customer',
                metadata: { account_id: params.get('metadata[account_id]') }
            };
            stripe_stub.customers.push(c);
            body = c;
        } else if (req.method === 'GET' && p.startsWith('/v1/customers/')) {
            body = stripe_stub.customers.find(c => c.id === p.split('/').pop()) || null;
            if (!body) status = 404;
        } else if (req.method === 'GET' && p === '/v1/prices') {
            const key = params.get('lookup_keys[0]');
            body = stripe_list([{ id: `price_${key}`, object: 'price', lookup_key: key }]);
        } else if (req.method === 'GET' && p === '/v1/checkout/sessions') {
            body = stripe_list([]);
        } else if (req.method === 'POST' && p.endsWith('/expire')) {
            stripe_stub.expired.push(p);
            body = { object: 'checkout.session', status: 'expired' };
        } else if (req.method === 'POST' && p === '/v1/checkout/sessions') {
            const id = `cs_smoke_${stripe_stub.checkouts.length + 1}`;
            stripe_stub.checkouts.push(Object.fromEntries(params));
            body = { id, object: 'checkout.session', url: `https://checkout.stripe.test/${id}` };
        } else if (req.method === 'POST' && p === '/v1/billing_portal/sessions') {
            body = { id: 'bps_smoke', url: 'https://billing.stripe.test/p' };
        } else {
            status = 404;
        }
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body || { error: { message: `stub: no ${req.method} ${p}` } }));
    });
});
const stripe_up = await new Promise(resolve => {
    stripe_server.once('error', err => resolve(err));
    stripe_server.listen(8196, '127.0.0.1', () => resolve(true));
});
check('stripe_stub_listening', stripe_up === true, String(stripe_up));

// Posts an event to the webhook, signed as Stripe signs them (or with `signature` as given)
let stripe_event_n = 0;
async function stripe_event(name, type, object, { id, signature, expectFail } = {}) {
    const event_id = id || `evt_smoke_${Date.now()}_${++stripe_event_n}`;
    const payload = JSON.stringify({
        id: event_id,
        object: 'event',
        type,
        created: Math.floor(Date.now() / 1000),
        data: { object }
    });
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto
        .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
        .update(`${t}.${payload}`)
        .digest('hex');
    const headers = { 'Content-Type': 'application/json' };
    if (signature !== null) headers['Stripe-Signature'] = signature || `t=${t},v1=${v1}`;
    const res = await fetch(`${BASE}/billing/webhook`, { method: 'POST', headers, body: payload });
    let data = await res.text();
    try {
        data = JSON.parse(data);
    } catch {}
    results[name] = { status: res.status, data };
    const ok = res.status < 400;
    if (ok !== !expectFail) failures++;
    console.log(`${ok === !expectFail ? 'ok  ' : 'FAIL'} ${res.status} ${name}`);
    return { data, event_id, payload };
}
const smoke_sub = (id, status, key) => ({
    id,
    object: 'subscription',
    status,
    created: Math.floor(Date.now() / 1000),
    cancel_at_period_end: false,
    items: {
        object: 'list',
        data: [{ price: { lookup_key: key }, current_period_end: 1893456000 }]
    }
});
const unv_plan = async name => await call(name, 'GET', '/usage', { token: unv_token });

const bill_internal = await call('billing_status_internal', 'GET', '/billing', { token });
check(
    'billing_internal_cannot_buy',
    bill_internal?.enabled === true && bill_internal?.can_buy === false,
    bill_internal
);
const bill_free = await call('billing_status_free', 'GET', '/billing', { token: unv_token });
check(
    'billing_free_no_customer',
    bill_free?.enabled === true &&
        bill_free?.can_buy === true &&
        bill_free?.plan === 'FREE' &&
        bill_free?.has_billing_account === false &&
        bill_free?.subscription === null &&
        stripe_stub.customers.length === 0,
    bill_free
);
await call('billing_portal_without_customer', 'POST', '/billing/portal', {
    token: unv_token,
    expectFail: true
});
await call('billing_checkout_bad_plan', 'POST', '/billing/checkout', {
    token: unv_token,
    body: { plan: 'FREE' },
    expectFail: true
});
await call('billing_checkout_no_session', 'POST', '/billing/checkout', {
    body: { plan: 'PRO' },
    expectFail: true
});
const bill_checkout = await call('billing_checkout', 'POST', '/billing/checkout', {
    token: unv_token,
    body: { plan: 'STARTER', interval: 'year' }
});
const smoke_customer = stripe_stub.customers[0]?.id;
const smoke_checkout = stripe_stub.checkouts[0] || {};
check(
    'billing_checkout_opened',
    typeof bill_checkout?.url === 'string' &&
        bill_checkout.url.startsWith('https://checkout.stripe.test/') &&
        smoke_customer &&
        stripe_stub.customers[0].metadata.account_id === String(unv_me?.id) &&
        smoke_checkout.mode === 'subscription' &&
        smoke_checkout.customer === smoke_customer &&
        smoke_checkout.client_reference_id === String(unv_me?.id) &&
        smoke_checkout['line_items[0][price]'] === 'price_invokedb_starter_year',
    { bill_checkout, smoke_checkout }
);

// Unsigned, badly signed and tampered events are refused, and change nothing
await stripe_event(
    'billing_webhook_unsigned',
    'invoice.paid',
    { customer: smoke_customer },
    {
        signature: null,
        expectFail: true
    }
);
await stripe_event(
    'billing_webhook_bad_signature',
    'invoice.paid',
    { customer: smoke_customer },
    {
        signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
        expectFail: true
    }
);
check(
    'billing_webhook_bad_signatures_400',
    results.billing_webhook_unsigned.status === 400 &&
        results.billing_webhook_bad_signature.status === 400
);

// Paid: Stripe now has an active Starter subscription
stripe_stub.subs[smoke_customer] = [smoke_sub('sub_smoke_1', 'active', 'invokedb_starter_year')];
const bill_created = await stripe_event(
    'billing_webhook_subscription_created',
    'customer.subscription.created',
    { id: 'sub_smoke_1', object: 'subscription', customer: smoke_customer }
);
const usage_starter = await unv_plan('billing_usage_starter');
check(
    'billing_upgrade_sets_plan',
    usage_starter?.plan?.id === 'STARTER' && usage_starter?.usage?.tables?.cap === 25,
    usage_starter?.plan
);
const bill_replay = await stripe_event(
    'billing_webhook_replay',
    'customer.subscription.created',
    { id: 'sub_smoke_1', object: 'subscription', customer: smoke_customer },
    { id: bill_created.event_id }
);
check('billing_webhook_replay_duplicate', bill_replay.data?.duplicate === true, bill_replay.data);
const bill_paid = await call('billing_status_paid', 'GET', '/billing', { token: unv_token });
check(
    'billing_status_shows_subscription',
    bill_paid?.has_billing_account === true &&
        bill_paid?.subscription?.plan === 'STARTER' &&
        bill_paid?.subscription?.interval === 'year' &&
        bill_paid?.subscription?.status === 'active',
    bill_paid
);
await call('billing_second_checkout', 'POST', '/billing/checkout', {
    token: unv_token,
    body: { plan: 'PRO' },
    expectFail: true
});
check('billing_second_checkout_409', results.billing_second_checkout.status === 409);
const bill_portal = await call('billing_portal', 'POST', '/billing/portal', { token: unv_token });
check('billing_portal_url', bill_portal?.url === 'https://billing.stripe.test/p', bill_portal);

// A failed payment keeps the plan in a grace period; the next payment ends it
stripe_stub.subs[smoke_customer][0].status = 'past_due';
await stripe_event('billing_webhook_payment_failed', 'invoice.payment_failed', {
    object: 'invoice',
    customer: smoke_customer
});
const usage_grace = await unv_plan('billing_usage_grace');
check(
    'billing_payment_failed_grace',
    usage_grace?.plan?.id === 'STARTER' &&
        usage_grace?.plan_state === 'grace' &&
        !!usage_grace?.grace_ends_at,
    usage_grace && { plan: usage_grace.plan, state: usage_grace.plan_state }
);
stripe_stub.subs[smoke_customer][0].status = 'active';
await stripe_event('billing_webhook_paid', 'invoice.paid', {
    object: 'invoice',
    customer: smoke_customer
});
const usage_paid = await unv_plan('billing_usage_paid_again');
check(
    'billing_paid_ends_grace',
    usage_paid?.plan?.id === 'STARTER' &&
        usage_paid?.plan_state === 'active' &&
        !usage_paid?.grace_ends_at,
    usage_paid && { plan: usage_paid.plan, state: usage_paid.plan_state }
);

// A plan change in the Portal, then the end of the subscription: back to Free. A late,
// older "updated" event after the "deleted" one doesn't bring the plan back.
stripe_stub.subs[smoke_customer][0].items.data[0].price.lookup_key = 'invokedb_pro_month';
await stripe_event('billing_webhook_plan_changed', 'customer.subscription.updated', {
    id: 'sub_smoke_1',
    object: 'subscription',
    customer: smoke_customer
});
const usage_pro = await unv_plan('billing_usage_pro');
check('billing_portal_change_to_pro', usage_pro?.plan?.id === 'PRO', usage_pro?.plan);
stripe_stub.subs[smoke_customer][0].status = 'canceled';
await stripe_event('billing_webhook_deleted', 'customer.subscription.deleted', {
    id: 'sub_smoke_1',
    object: 'subscription',
    customer: smoke_customer
});
await stripe_event('billing_webhook_late_update', 'customer.subscription.updated', {
    id: 'sub_smoke_1',
    object: 'subscription',
    customer: smoke_customer
});
const usage_lapsed = await unv_plan('billing_usage_lapsed');
check(
    'billing_cancel_back_to_free',
    usage_lapsed?.plan?.id === 'FREE' && usage_lapsed?.usage?.tables?.cap === 3,
    usage_lapsed?.plan
);

// Subscribed again: deleting the account cancels the subscription in Stripe (below)
stripe_stub.subs[smoke_customer].push(smoke_sub('sub_smoke_2', 'active', 'invokedb_pro_month'));
await stripe_event('billing_webhook_resubscribed', 'customer.subscription.created', {
    id: 'sub_smoke_2',
    object: 'subscription',
    customer: smoke_customer
});
const usage_again = await unv_plan('billing_usage_resubscribed');
check('billing_resubscribed_pro', usage_again?.plan?.id === 'PRO', usage_again?.plan);

if (unv_dir) {
    await call('unverified_folder_delete', 'POST', '/file-directory/batch_delete', {
        token: unv_token,
        body: { ids: [unv_dir] }
    });
}
// Deleting an account deletes its data at once (#279). What's left of an account in Mongo: its
// own database, its tracking collections (`...:acct_<id>`) and its documents in the shared
// tracking collections (AccountDeletionService's list). Read straight from Mongo, with the
// backend's driver and the smoke env file's settings (HORIZON_ENV_FILE); without them the Mongo
// checks are skipped (the re-signup below still shows the account row is gone).
const SHARED_TRACKING = [
    'tracking:url_source',
    'tracking:webhook',
    'tracking:webhook_delivery',
    'tracking:form',
    'tracking:view',
    'tracking:audit',
    'tracking:ai_usage',
    'tracking:api_key_request',
    'tracking:account_export',
    'tracking:ai_column'
];
function smoke_env_value(name) {
    const env_file = process.env.HORIZON_ENV_FILE;
    if (process.env[name]) return process.env[name];
    if (!env_file || !fs.existsSync(env_file)) return null;
    const line = fs
        .readFileSync(env_file, 'utf8')
        .split('\n')
        .filter(l => l.startsWith(`${name}=`))
        .pop();
    return line
        ? line
              .slice(name.length + 1)
              .trim()
              .replace(/^["']|["']$/g, '')
        : null;
}
async function account_leftovers(account_id) {
    const uri = smoke_env_value('HORIZON_MONGO_URI');
    const db_name = smoke_env_value('HORIZON_MONGO_DB');
    const tracking_uri = smoke_env_value('HORIZON_MONGO_TRACKING_URI') || uri;
    const tracking_name = smoke_env_value('HORIZON_MONGO_TRACKING_DB');
    if (!uri || !db_name || !tracking_name || !Number.isInteger(account_id)) return null;
    let MongoClient;
    try {
        const be_require = createRequire(
            new URL('../packages/horizon-be/package.json', import.meta.url)
        );
        ({ MongoClient } = be_require('mongodb'));
    } catch {
        return null;
    }
    const left = [];
    const clients = [];
    try {
        const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000 });
        clients.push(client);
        const dbs = await client.db().admin().listDatabases({ nameOnly: true });
        const own = `${db_name}:acct_${account_id}`;
        if (dbs.databases.some(d => d.name === own)) left.push(own);
        const t_client =
            tracking_uri === uri
                ? client
                : await MongoClient.connect(tracking_uri, { serverSelectionTimeoutMS: 5000 });
        if (t_client !== client) clients.push(t_client);
        const tracking = t_client.db(tracking_name);
        const names = await tracking.listCollections({}, { nameOnly: true }).toArray();
        for (const { name } of names) {
            if (name.endsWith(`:acct_${account_id}`)) left.push(name);
        }
        for (const name of SHARED_TRACKING) {
            const n = await tracking.collection(name).countDocuments({ account_id });
            if (n) left.push(`${name} (${n})`);
        }
    } catch (ex) {
        console.log(`      (Mongo not readable for the deletion checks: ${ex.message})`);
        return null;
    } finally {
        for (const c of clients) await c.close().catch(() => {});
    }
    return left;
}
// Checks an account's data was there before it was deleted and is gone after
async function check_account_data_gone(name, account_id, before) {
    if (before === null) {
        console.log(`skip --- ${name}_data_gone (no Mongo settings or driver)`);
        return;
    }
    const after = await account_leftovers(account_id);
    check(`${name}_data_there_before`, before.length > 0, before);
    check(`${name}_data_gone`, Array.isArray(after) && after.length === 0, after);
}
// The account row is gone too: the same email signs up again as a new account (a deleted but
// kept row would answer the same but make none, so the new password wouldn't sign in)
async function check_email_free_again(name, email) {
    const password = 'Again-pass1!';
    await call(`${name}_signup_again`, 'POST', '/auth/create-account', {
        body: { email, password }
    });
    const again = await call(`${name}_login_again`, 'POST', '/auth/login', {
        body: { email, password }
    });
    check(`${name}_account_row_gone`, !!again?.token, results[`${name}_login_again`]);
    if (!again?.token) return;
    const again_me = await call(
        `${name}_again_authorize`,
        'GET',
        `/auth/authorize?token=${again.token}`
    );
    if (again_me?.id) {
        await call(`${name}_again_delete`, 'PUT', `/account/delete_account/${again_me.id}`, {
            token: again.token
        });
    }
}

// Deleting an account ends all its sessions (#282): a second session, as from another device,
// is refused at once on internal routes and `authorize` answers null for it
const second_session = await call('deleted_account_second_login', 'POST', '/auth/login', {
    body: { email: signup_email, password: signup_password }
});
const second_token = second_session?.token;
const unv_before_delete = await account_leftovers(unv_me?.id);
if (unv_me?.id) {
    await call('unverified_delete_account', 'PUT', `/account/delete_account/${unv_me.id}`, {
        token: unv_token
    });
    check(
        'unverified_delete_account_answer',
        results.unverified_delete_account?.data?.deleted === true,
        results.unverified_delete_account
    );
    await check_account_data_gone('unverified_delete', unv_me.id, unv_before_delete);
}
await call('deleted_account_second_session', 'GET', '/file-directory', {
    token: second_token,
    expectFail: true
});
check(
    'deleted_account_second_session_401',
    !!second_token && results.deleted_account_second_session.status === 401,
    results.deleted_account_second_session
);
const second_me = await call(
    'deleted_account_second_authorize',
    'GET',
    `/auth/authorize?token=${second_token}`
);
check(
    'deleted_account_authorize_null',
    !!second_token && (second_me === null || second_me === ''),
    second_me
);
await call('deleted_account_first_session', 'GET', '/file-directory', {
    token: unv_token,
    expectFail: true
});
await call('unverified_logout', 'GET', `/auth/logout?token=${unv_token}`);
// One signup more per run (create-account allows 10 an hour per IP), so only here
if (unv_me?.id) await check_email_free_again('unverified_delete', signup_email);
check(
    'billing_deleted_account_cancelled',
    stripe_stub.cancelled.includes('sub_smoke_2') && !stripe_stub.cancelled.includes('sub_smoke_1'),
    stripe_stub.cancelled
);
stripe_server.closeAllConnections();
stripe_server.close();

// Limits (#182). Columns: 52 per table on every route that turns a column on (batch create,
// single save, batch save), and saving all the columns of a full table still works.
const col_table = await call('col_limit_table', 'POST', '/file-directory', {
    token,
    body: { account_id: me.id, name: 'smoke_col_limit', type: 'file', web_file_type: 'data-grid' }
});
const active_cols = async name =>
    (
        (
            await call(name, 'POST', `/web-file/data_grid_column/${col_table}?skip=0&limit=200`, {
                token,
                body: {}
            })
        )?.data || []
    ).filter(c => !c.deleted);
const new_cols = (from, n) =>
    Array.from({ length: n }, (_, i) => ({
        file_directory_id: col_table,
        col_index: from + i,
        order: from + i,
        field: `x${from + i}`,
        headerName: `col${from + i}`,
        width: 120
    }));
await call('col_limit_create_49', 'POST', `/web-file/batch_create/data_grid_column/${col_table}`, {
    token,
    body: new_cols(4, 49)
});
const full_cols = await active_cols('col_limit_full');
check('col_limit_full_52', full_cols.length === 52, full_cols.length);
await call(
    'col_limit_create_53rd',
    'POST',
    `/web-file/batch_create/data_grid_column/${col_table}`,
    { token, body: new_cols(53, 1), expectFail: true }
);
const placeholder = await call(
    'col_limit_placeholder',
    'GET',
    `/web-file/${col_table}/get_new_column`,
    {
        token
    }
);
await call(
    'col_limit_save_53rd',
    'PUT',
    `/web-file/${placeholder?._id}/data_grid_column/${col_table}`,
    { token, body: { ...placeholder, headerName: 'col53', deleted: false }, expectFail: true }
);
await call('col_limit_batch_53rd', 'PUT', `/web-file/batch_update/data_grid_column/${col_table}`, {
    token,
    body: [...full_cols, { ...placeholder, headerName: 'col53', deleted: false }],
    expectFail: true
});
await call('col_limit_save_all', 'PUT', `/web-file/batch_update/data_grid_column/${col_table}`, {
    token,
    body: full_cols.map(c => ({ ...c, width: 150 }))
});
check(
    'col_limit_refused_403',
    ['col_limit_create_53rd', 'col_limit_save_53rd', 'col_limit_batch_53rd'].every(
        n => results[n]?.status === 403
    ),
    ['col_limit_create_53rd', 'col_limit_save_53rd', 'col_limit_batch_53rd'].map(
        n => results[n]?.status
    )
);
const after_cols = await active_cols('col_limit_after');
check(
    'col_limit_nothing_saved',
    after_cols.length === 52 && after_cols.every(c => c.width === 150),
    after_cols.length
);
await call('col_limit_table_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [col_table] }
});

// The account's /api/v1 rate limit (#183): a burst of parallel calls from a Free account (demo5,
// put on Free by smoke-env.sh: 2 a second, bursts of 10) gets 429s with Retry-After.
const rl_session = await call('rate_limit_login', 'POST', '/auth/login', {
    body: { email: 'demo5@invokedb.com', password: 'password' }
});
const rl_token = rl_session?.token;
const rl_me = await call('rate_limit_authorize', 'GET', `/auth/authorize?token=${rl_token}`);
const rl_key = await call('rate_limit_key', 'POST', '/api-key', {
    token: rl_token,
    body: { name: 'smoke_rate', access: 'read' }
});
const rl_table = await call('rate_limit_table', 'POST', '/file-directory', {
    token: rl_token,
    body: { account_id: rl_me?.id, name: 'smoke_rate', type: 'file', web_file_type: 'data-grid' }
});
const rl_burst = await Promise.all(
    Array.from({ length: 120 }, () =>
        fetch(`${BASE}/api/v1/get?table=smoke_rate&skip=0&limit=1`, {
            headers: { Authorization: `Bearer ${rl_key?.secret}` }
        }).then(async r => {
            await r.text();
            return { status: r.status, retry_after: r.headers.get('retry-after') };
        })
    )
);
const rl_ok = rl_burst.filter(r => r.status === 200).length;
const rl_429 = rl_burst.filter(r => r.status === 429);
results.rate_limit_burst = { ok: rl_ok, limited: rl_429.length };
check(
    'rate_limit_429_retry_after',
    rl_ok > 0 &&
        rl_ok <= 100 &&
        rl_ok + rl_429.length === rl_burst.length &&
        rl_429.length >= 20 &&
        rl_429.every(
            r => /^\d+$/.test(r.retry_after || '') && +r.retry_after >= 1 && +r.retry_after <= 60
        ),
    {
        ok: rl_ok,
        statuses: [...new Set(rl_burst.map(r => r.status))],
        retry: rl_429[0]?.retry_after
    }
);
if (rl_table) {
    await call('rate_limit_table_delete', 'POST', '/file-directory/batch_delete', {
        token: rl_token,
        body: { ids: [rl_table] }
    });
}
if (rl_key?.key?.id) {
    await call('rate_limit_key_delete', 'DELETE', `/api-key/${rl_key.key.id}`, { token: rl_token });
}
await call('rate_limit_logout', 'GET', `/auth/logout?token=${rl_token}`);

// Uploads over 100 MB answer 413 and leave no table and no temp file. The temp folder is read
// from the smoke env file (HORIZON_ENV_FILE) when there is one.
function upload_temp_dir() {
    const env_file = process.env.HORIZON_ENV_FILE;
    if (!env_file || !fs.existsSync(env_file)) return null;
    const line = fs
        .readFileSync(env_file, 'utf8')
        .split('\n')
        .filter(l => l.startsWith('HORIZON_FILE_SHARE='))
        .pop();
    if (!line) return null;
    const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
    const share = line
        .slice('HORIZON_FILE_SHARE='.length)
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace('${HORIZON_ROOT}', root);
    return `${share}/temp`;
}
const temp_dir = upload_temp_dir();
const temp_files = () =>
    temp_dir && fs.existsSync(temp_dir)
        ? fs.readdirSync(temp_dir).filter(f => f.startsWith(`acct-${me.id}_`))
        : [];
const temp_before = temp_files();
const big_form = new FormData();
big_form.append('new_name', 'smoke_too_big');
big_form.append(
    'file',
    new Blob([new Uint8Array(100 * 1024 * 1024 + 1).fill(97)], { type: 'text/csv' }),
    'big.csv'
);
let big_status = null;
try {
    const big_res = await fetch(`${BASE}/web-file/file_upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: big_form
    });
    await big_res.text();
    big_status = big_res.status;
} catch (ex) {
    big_status = `error: ${ex.message}`;
}
check('upload_too_big_413', big_status === 413, big_status);
const after_big = await call('upload_too_big_list', 'GET', '/file-directory', { token });
check(
    'upload_too_big_no_table',
    Array.isArray(after_big) && !after_big.some(d => d.name === 'smoke_too_big'),
    after_big
);
if (temp_dir) {
    const left = temp_files().filter(f => !temp_before.includes(f));
    check('upload_too_big_no_temp_file', left.length === 0, left);
} else {
    console.log('     (no HORIZON_ENV_FILE: temp folder not checked)');
}

// Plans (#183). GET /plans is public and has the decided caps. demo7 is on Free with tiny caps
// (smoke-env.sh's HORIZON_TEST_PLANS: 2 tables, 4 rows per table, 7 rows in all, 4 columns, 5 API
// calls a month, query pages of 2, 300-byte uploads, 1 view per table; Free's own 1 webhook,
// 1 form, 1 URL source with daily syncs only): each cap is allowed up to it and refused past it
// on every path with 403 `plan_limit` (413 for an upload, 429 for the API quota). demo6 is on
// Starter with a 1-byte storage cap. GET /usage matches and is the caller's own.
const plan_limit_is = (name, limit, status = 403) =>
    check(
        `${name}_plan_limit`,
        results[name]?.status === status &&
            results[name]?.data?.code === 'plan_limit' &&
            results[name]?.data?.limit === limit &&
            /\/pricing$/.test(results[name]?.data?.upgrade_url || ''),
        results[name]
    );
const pub_plans = await call('plans_public', 'GET', '/plans');
const plan_of = id => (pub_plans?.plans || []).find(p => p.id === id);
check(
    'plans_public_decided',
    JSON.stringify((pub_plans?.plans || []).map(p => p.id)) ===
        JSON.stringify(['FREE', 'STARTER', 'PRO']) &&
        plan_of('FREE')?.caps?.tables === 3 &&
        plan_of('FREE')?.caps?.rows_per_account === 3000 &&
        plan_of('STARTER')?.price_month_usd === 9 &&
        plan_of('STARTER')?.caps?.api_calls_per_month === 250000 &&
        plan_of('PRO')?.price_month_usd === 29 &&
        plan_of('PRO')?.caps?.rows_per_account === 1000000,
    pub_plans
);
await call('usage_no_token', 'GET', '/usage', { expectFail: true });

// Leftovers of an earlier run on the same databases: tables (their views and URL sources go
// with them), forms, webhooks and keys
async function plan_cleanup(prefix, tok) {
    const forms = await call(`${prefix}_cleanup_forms`, 'GET', '/form', { token: tok });
    for (const [i, f] of (forms?.forms || []).entries()) {
        await call(`${prefix}_cleanup_form_${i}`, 'DELETE', `/form/${f.id}`, { token: tok });
    }
    const hooks = await call(`${prefix}_cleanup_hooks`, 'GET', '/webhook', { token: tok });
    for (const [i, h] of (hooks?.webhooks || []).entries()) {
        await call(`${prefix}_cleanup_hook_${i}`, 'DELETE', `/webhook/${h.id}`, { token: tok });
    }
    const keys = await call(`${prefix}_cleanup_keys`, 'GET', '/api-key', { token: tok });
    for (const [i, k] of (keys?.keys || []).filter(k => !k.revoked_datetime).entries()) {
        await call(`${prefix}_cleanup_key_${i}`, 'DELETE', `/api-key/${k.id}`, { token: tok });
    }
    const dirs = await call(`${prefix}_cleanup_tables`, 'GET', '/file-directory', { token: tok });
    const ids = (Array.isArray(dirs) ? dirs : []).filter(d => d.type === 'file').map(d => d.id);
    if (ids.length > 0) {
        await call(`${prefix}_cleanup_delete`, 'POST', '/file-directory/batch_delete', {
            token: tok,
            body: { ids }
        });
    }
}
const new_table = (tok, acct, name) => ({
    token: tok,
    body: { account_id: acct, name, type: 'file', web_file_type: 'data-grid' }
});
// Waits for an upload or URL import to be processed; answers the table
async function plan_settled(name, tok, id) {
    let dir;
    for (let i = 0; i < 40; i++) {
        const dirs = await call(`${name}_poll`, 'GET', '/file-directory', { token: tok });
        dir = (Array.isArray(dirs) ? dirs : []).find(d => d.id === id);
        if (dir && dir.status !== 'PENDING' && dir.status !== 'PROCESSING') break;
        await sleep(1000);
    }
    return dir;
}
const csv_form = (name, text) => {
    const f = new FormData();
    f.append('file', new Blob([text], { type: 'text/csv' }), `${name}.csv`);
    f.append('new_name', name);
    return f;
};

const p7_session = await call('plan_free_login', 'POST', '/auth/login', {
    body: { email: 'demo7@invokedb.com', password: 'password' }
});
const p7 = p7_session?.token;
const p7_me = await call('plan_free_authorize', 'GET', `/auth/authorize?token=${p7}`);
await plan_cleanup('plan_free', p7);
const u7_start = await call('plan_free_usage_start', 'GET', '/usage', { token: p7 });
check(
    'plan_free_usage_caps',
    u7_start?.plan?.id === 'FREE' &&
        u7_start?.internal === false &&
        u7_start?.usage?.tables?.cap === 2 &&
        u7_start?.usage?.tables?.used === 0 &&
        u7_start?.usage?.rows_per_table?.cap === 4 &&
        u7_start?.usage?.rows_per_account?.cap === 7 &&
        u7_start?.usage?.columns_per_table?.cap === 4 &&
        u7_start?.usage?.api_calls_per_month?.cap === 5 &&
        u7_start?.usage?.storage_bytes?.cap === 10 * 1024 * 1024 &&
        u7_start?.usage?.url_sources?.cap === 1 &&
        u7_start?.usage?.webhooks?.cap === 1 &&
        u7_start?.usage?.forms?.cap === 1 &&
        u7_start?.usage?.views_per_table?.cap === 1 &&
        u7_start?.limits?.query_page === 2 &&
        u7_start?.limits?.csv_upload_bytes === 300 &&
        u7_start?.limits?.key_limits_and_logs === false &&
        u7_start?.limits?.audit_keep_days === 7,
    u7_start
);

// Tables (cap 2): one, then three in parallel at the cap - 1 make at most one
const pa = await call(
    'plan_table_a',
    'POST',
    '/file-directory',
    new_table(p7, p7_me?.id, 'smoke_plan_a')
);
const par = await Promise.all(
    [0, 1, 2].map(i =>
        fetch(`${BASE}/file-directory`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${p7}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(new_table(p7, p7_me?.id, `smoke_plan_par_${i}`).body)
        }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }))
    )
);
results.plan_table_parallel = par.map(r => r.status);
const par_made = par.filter(r => r.status < 300);
check(
    'plan_table_parallel_at_most_one',
    par_made.length <= 1 && par.filter(r => r.status === 403).length === 3 - par_made.length,
    par
);
let pb = par_made[0]?.data;
if (!pb) {
    pb = await call(
        'plan_table_b',
        'POST',
        '/file-directory',
        new_table(p7, p7_me?.id, 'smoke_plan_b')
    );
}
// At the cap, every way of making a table is refused, and makes nothing
await call('plan_table_app_over', 'POST', '/file-directory', {
    ...new_table(p7, p7_me?.id, 'smoke_plan_c'),
    expectFail: true
});
plan_limit_is('plan_table_app_over', 'tables');
await call('plan_table_template_over', 'POST', '/table-template/waitlist', {
    token: p7,
    body: { name: 'smoke_plan_tpl' },
    expectFail: true
});
plan_limit_is('plan_table_template_over', 'tables');
await call('plan_table_csv_over', 'POST', '/web-file/file_upload', {
    token: p7,
    form: csv_form('smoke_plan_csv', 'x,y\n1,2\n'),
    expectFail: true
});
plan_limit_is('plan_table_csv_over', 'tables');
await call('plan_table_url_over', 'POST', '/url-import', {
    token: p7,
    body: { new_name: 'smoke_plan_url_over', url: `${RAW}/examples/data/todo.csv` },
    expectFail: true
});
plan_limit_is('plan_table_url_over', 'tables');
const p7_dirs = await call('plan_tables_at_cap', 'GET', '/file-directory', { token: p7 });
check(
    'plan_tables_refused_made_nothing',
    Array.isArray(p7_dirs) && p7_dirs.filter(d => d.type === 'file').length === 2,
    p7_dirs
);

// Rows: each new table has 3 rows (6 in all). A 4th in A fits (7 in all); a 5th passes the
// per-table cap, and a 4th in B the account's
const add_row = (name, id, opts = {}) =>
    call(name, 'POST', `/web-file/batch_create/data_grid_row/${id}`, {
        token: p7,
        body: [{ a: 'x' }],
        ...opts
    });
await add_row('plan_rows_a_4th', pa);
await add_row('plan_rows_a_5th', pa, { expectFail: true });
plan_limit_is('plan_rows_a_5th', 'rows_per_table');
await add_row('plan_rows_b_4th', pb, { expectFail: true });
plan_limit_is('plan_rows_b_4th', 'rows_per_account');

// Columns (cap 4): A has 3. A 4th fits; a 5th is refused, made or switched on
const new_col = (n, field) => ({
    file_directory_id: pa,
    col_index: n,
    order: n,
    field,
    headerName: `col${n}`,
    width: 120
});
await call('plan_col_4th', 'POST', `/web-file/batch_create/data_grid_column/${pa}`, {
    token: p7,
    body: [new_col(4, 'd')]
});
await call('plan_col_5th', 'POST', `/web-file/batch_create/data_grid_column/${pa}`, {
    token: p7,
    body: [new_col(5, 'e')],
    expectFail: true
});
plan_limit_is('plan_col_5th', 'columns_per_table');
const p7_placeholder = await call('plan_col_placeholder', 'GET', `/web-file/${pa}/get_new_column`, {
    token: p7
});
await call('plan_col_save_5th', 'PUT', `/web-file/${p7_placeholder?._id}/data_grid_column/${pa}`, {
    token: p7,
    body: { ...p7_placeholder, headerName: 'col5', deleted: false },
    expectFail: true
});
plan_limit_is('plan_col_save_5th', 'columns_per_table');

// API keys: no per-key rate limit or request log on Free
const k7 = await call('plan_free_key', 'POST', '/api-key', {
    token: p7,
    body: { name: 'smoke plan', access: 'read_write' }
});
await call('plan_free_key_rate_limit', 'POST', '/api-key', {
    token: p7,
    body: { name: 'smoke plan limited', access: 'read', rate_limit_per_second: 1 },
    expectFail: true
});
plan_limit_is('plan_free_key_rate_limit', 'key_limits_and_logs');

// The API (5 calls a month): a query page over 2 is a 400, a create over the row cap a 403, and
// every call counts until the 429, which lasts until the 1st (UTC). A rerun in the same month
// starts at the quota.
const p7_calls = u7_start?.usage?.api_calls_per_month?.used ?? 0;
// The calls made before the loop below: 3 when there was room for them
const p7_calls_before_loop = p7_calls + 3 <= 5 ? p7_calls + 3 : p7_calls;
const v1 = (path, init = {}) =>
    fetch(`${BASE}/api/v1/${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${k7?.secret}`, 'Content-Type': 'application/json' }
    }).then(async r => ({
        status: r.status,
        retry_after: r.headers.get('retry-after'),
        data: await r.json().catch(() => null)
    }));
if (p7_calls_before_loop > p7_calls) {
    results.plan_api_query_over = await v1('query?table=smoke_plan_a', {
        method: 'POST',
        body: JSON.stringify({ limit: 3 })
    });
    check('plan_api_query_over_400', results.plan_api_query_over.status === 400);
    results.plan_api_query_page = await v1('query?table=smoke_plan_a', {
        method: 'POST',
        body: JSON.stringify({ limit: 2 })
    });
    check(
        'plan_api_query_page_2',
        results.plan_api_query_page.status === 200 &&
            results.plan_api_query_page.data?.data?.length === 2,
        results.plan_api_query_page
    );
    results.plan_api_create_over = await v1('create?table=smoke_plan_a', {
        method: 'POST',
        body: JSON.stringify([{ column1: 'x' }])
    });
    plan_limit_is('plan_api_create_over', 'rows_per_table');
} else {
    console.log('     (demo7 used its API calls earlier this month: page and create not checked)');
}
const quota_statuses = [];
let quota_hit = null;
for (let i = 0; i < 8; i++) {
    const r = await v1('get?table=smoke_plan_a&skip=0&limit=1');
    quota_statuses.push(r.status);
    if (r.status === 429) {
        quota_hit = r;
        break;
    }
}
results.plan_api_quota = { statuses: quota_statuses, hit: quota_hit };
check(
    'plan_api_quota_429_until_next_month',
    quota_hit?.data?.code === 'plan_limit' &&
        quota_hit?.data?.limit === 'api_calls_per_month' &&
        Number(quota_hit?.retry_after) >= 1 &&
        Number(quota_hit?.retry_after) <= 31 * 24 * 3600 &&
        quota_statuses.slice(0, -1).every(s => s === 200) &&
        quota_statuses.length - 1 === Math.max(0, 5 - p7_calls_before_loop),
    results.plan_api_quota
);
// The app's own routes don't count and still work
await call('plan_app_after_quota', 'POST', `/web-file/data_grid_row/${pa}?skip=0&limit=1`, {
    token: p7,
    body: {}
});

// Forms (1), and a submission to a table at its row cap is refused
const f7 = await call('plan_form_1', 'POST', '/form', {
    token: p7,
    body: { file_id: pa, title: 'smoke plan form', fields: [{ field: 'a' }] }
});
await call('plan_form_2', 'POST', '/form', {
    token: p7,
    body: { file_id: pa, title: 'smoke plan form 2', fields: [{ field: 'a' }] },
    expectFail: true
});
plan_limit_is('plan_form_2', 'forms');
await call('plan_form_submit_full', 'POST', `/public/form/${f7?.id}/submit`, {
    body: { values: { a: 'x' }, website: '' },
    expectFail: true
});
status_is('plan_form_submit_full', 403);

// Views (1 per table) and webhooks (1)
await call('plan_view_1', 'POST', '/view', {
    token: p7,
    body: { file_id: pa, name: 'smoke plan view', type: 'grid' }
});
await call('plan_view_2', 'POST', '/view', {
    token: p7,
    body: { file_id: pa, name: 'smoke plan view 2', type: 'grid' },
    expectFail: true
});
plan_limit_is('plan_view_2', 'views_per_table');
await call('plan_webhook_1', 'POST', '/webhook', {
    token: p7,
    body: { url: `http://${HOOK_HOST}/plan`, events: ['row.updated'], file_id: pa }
});
await call('plan_webhook_2', 'POST', '/webhook', {
    token: p7,
    body: { url: `http://${HOOK_HOST}/plan`, events: ['row.updated'], file_id: pa },
    expectFail: true
});
plan_limit_is('plan_webhook_2', 'webhooks');

// Uploads: over 300 bytes is a 413 before any table is made; with B gone, a CSV with too many
// columns or rows makes a table whose processing is refused
await call('plan_table_b_delete', 'POST', '/file-directory/batch_delete', {
    token: p7,
    body: { ids: [pb] }
});
await call('plan_csv_too_big', 'POST', '/web-file/file_upload', {
    token: p7,
    form: csv_form('smoke_plan_big', `x\n${'1\n'.repeat(200)}`),
    expectFail: true
});
plan_limit_is('plan_csv_too_big', 'csv_upload_bytes', 413);
const csv_wide = await call('plan_csv_wide', 'POST', '/web-file/file_upload', {
    token: p7,
    form: csv_form('smoke_plan_wide', 'a,b,c,d,e\n1,2,3,4,5\n')
});
const wide_dir = await plan_settled('plan_csv_wide', p7, csv_wide);
check(
    'plan_csv_wide_refused',
    wide_dir?.status === 'ERROR' && /columns per table/.test(wide_dir?.status_reason || ''),
    wide_dir
);
await call('plan_csv_wide_delete', 'POST', '/file-directory/batch_delete', {
    token: p7,
    body: { ids: [csv_wide] }
});
const csv_long = await call('plan_csv_long', 'POST', '/web-file/file_upload', {
    token: p7,
    form: csv_form('smoke_plan_long', `x\n${'1\n'.repeat(5)}`)
});
const long_dir = await plan_settled('plan_csv_long', p7, csv_long);
check(
    'plan_csv_long_refused',
    long_dir?.status === 'ERROR' && /rows per table/.test(long_dir?.status_reason || ''),
    long_dir
);
await call('plan_csv_long_delete', 'POST', '/file-directory/batch_delete', {
    token: p7,
    body: { ids: [csv_long] }
});

// URL sources (1, daily syncs only): an hourly one is refused before a table is made; then one,
// and a second is refused; switching the first to hourly is refused
await call('plan_url_hourly', 'POST', '/url-import', {
    token: p7,
    body: {
        new_name: 'smoke_plan_url_h',
        url: `${RAW}/examples/data/todo.csv`,
        schedule: 'hourly'
    },
    expectFail: true
});
plan_limit_is('plan_url_hourly', 'url_sync_schedules');
const p7_url = await call('plan_url_1', 'POST', '/url-import', {
    token: p7,
    body: { new_name: 'smoke_plan_url', url: `${RAW}/examples/data/todo.csv`, schedule: 'daily' }
});
await call('plan_url_2', 'POST', '/url-import', {
    token: p7,
    body: { new_name: 'smoke_plan_url_2', url: `${RAW}/examples/data/todo.csv` },
    expectFail: true
});
plan_limit_is('plan_url_2', 'url_sources');
await call('plan_url_to_hourly', 'PUT', `/url-import/${p7_url}`, {
    token: p7,
    body: { schedule: 'hourly' },
    expectFail: true
});
plan_limit_is('plan_url_to_hourly', 'url_sync_schedules');
// todo.csv has more rows than the cap: the import is refused, and the table stays
const url_dir = await plan_settled('plan_url_1', p7, p7_url);
check('plan_url_import_refused', url_dir?.status === 'ERROR', url_dir);

// GET /usage counts what was made; another account's usage doesn't show it
const u7 = await call('plan_free_usage_end', 'GET', '/usage', { token: p7 });
check(
    'plan_free_usage_matches',
    u7?.usage?.tables?.used === 2 &&
        u7?.usage?.rows_per_account?.used === 4 &&
        u7?.usage?.rows_per_table?.used === 4 &&
        u7?.usage?.columns_per_table?.used === 4 &&
        u7?.usage?.api_calls_per_month?.used === 5 &&
        u7?.usage?.url_sources?.used === 1 &&
        u7?.usage?.webhooks?.used === 1 &&
        u7?.usage?.forms?.used === 1 &&
        u7?.usage?.views_per_table?.used === 1 &&
        u7?.usage?.storage_bytes?.used > 0 &&
        (u7?.tables || []).some(t => t.id === pa && t.rows === 4 && t.columns === 4),
    u7
);
const p2 = (
    await call('plan_other_login', 'POST', '/auth/login', {
        body: { email: 'demo2@invokedb.com', password: 'password' }
    })
)?.token;
const u2 = await call('plan_other_usage', 'GET', '/usage', { token: p2 });
await call('plan_other_logout', 'GET', `/auth/logout?token=${p2}`);
check(
    'plan_usage_is_own',
    u2?.internal === true &&
        u2?.usage?.tables?.cap === null &&
        !(u2?.tables || []).some(t => String(t.name).startsWith('smoke_plan')),
    u2
);
await call('plan_usage_with_key', 'GET', '/usage', { token: k7?.secret, expectFail: true });
await plan_cleanup('plan_free_end', p7);
await call('plan_free_logout', 'GET', `/auth/logout?token=${p7}`);

// A paid plan: demo6 on Starter has its caps and per-key limits, and a 1-byte storage cap
// refuses every write that adds data (a new table's own empty rows are let in)
const p6_session = await call('plan_paid_login', 'POST', '/auth/login', {
    body: { email: 'demo6@invokedb.com', password: 'password' }
});
const p6 = p6_session?.token;
const p6_me = await call('plan_paid_authorize', 'GET', `/auth/authorize?token=${p6}`);
await plan_cleanup('plan_paid', p6);
const u6 = await call('plan_paid_usage', 'GET', '/usage', { token: p6 });
check(
    'plan_paid_usage_caps',
    u6?.plan?.id === 'STARTER' &&
        u6?.internal === false &&
        u6?.usage?.tables?.cap === 25 &&
        u6?.usage?.rows_per_account?.cap === 100000 &&
        u6?.usage?.storage_bytes?.cap === 1 &&
        u6?.limits?.query_page === 1000 &&
        u6?.limits?.key_limits_and_logs === true &&
        u6?.limits?.audit_keep_days === 30,
    u6
);
const p6t = await call(
    'plan_paid_table',
    'POST',
    '/file-directory',
    new_table(p6, p6_me?.id, 'smoke_plan_paid')
);
await call('plan_paid_row', 'POST', `/web-file/batch_create/data_grid_row/${p6t}`, {
    token: p6,
    body: [{ a: 'x' }],
    expectFail: true
});
plan_limit_is('plan_paid_row', 'storage_bytes');
const k6 = await call('plan_paid_key', 'POST', '/api-key', {
    token: p6,
    body: { name: 'smoke plan paid', access: 'read_write', rate_limit_per_second: 1 }
});
check('plan_paid_key_rate_limit', k6?.key?.rate_limit?.per_second === 1, k6?.key);
results.plan_paid_api_create = await fetch(`${BASE}/api/v1/create?table=smoke_plan_paid`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${k6?.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ column1: 'x' }])
}).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
plan_limit_is('plan_paid_api_create', 'storage_bytes');
await call('plan_paid_csv', 'POST', '/web-file/file_upload', {
    token: p6,
    form: csv_form('smoke_plan_paid_csv', 'x\n1\n'),
    expectFail: true
});
plan_limit_is('plan_paid_csv', 'storage_bytes');
await plan_cleanup('plan_paid_end', p6);
await call('plan_paid_logout', 'GET', `/auth/logout?token=${p6}`);

// The read-only state (#184). demo5 (listed in smoke-env.sh's HORIZON_TEST_PLANS) is put on Pro
// with the test-only PUT /test-plan, makes two tables and a form, then "downgrades" to a Free
// with 1 table and fewer rows than it has: it's read-only. Reads, the export and deletes work;
// every write path is refused with 403 `plan_read_only`. Deleting down to the caps makes it
// writable again at once (and a write past a cap is then an ordinary `plan_limit`). In a block
// of its own, so its names can't clash with the rest of the script.
{
    const read_only_is = name =>
        check(
            `${name}_read_only`,
            results[name]?.status === 403 &&
                results[name]?.data?.code === 'plan_read_only' &&
                Array.isArray(results[name]?.data?.over) &&
                /\/pricing$/.test(results[name]?.data?.upgrade_url || ''),
            results[name]
        );
    const r5_session = await call('ro_login', 'POST', '/auth/login', {
        body: { email: 'demo5@invokedb.com', password: 'password' }
    });
    const r5 = r5_session?.token;
    const r5_me = await call('ro_authorize', 'GET', `/auth/authorize?token=${r5}`);
    await call('ro_test_plan_reset_start', 'DELETE', '/test-plan', { token: r5 });
    await plan_cleanup('ro', r5);
    // Only an account HORIZON_TEST_PLANS lists may use the test route, and never with a key
    const r2 = (
        await call('ro_other_login', 'POST', '/auth/login', {
            body: { email: 'demo2@invokedb.com', password: 'password' }
        })
    )?.token;
    await call('ro_test_plan_other', 'PUT', '/test-plan', {
        token: r2,
        body: { plan: 'FREE' },
        expectFail: true
    });
    status_is('ro_test_plan_other', 404);
    await call('ro_other_logout', 'GET', `/auth/logout?token=${r2}`);
    const ro_pro = await call('ro_test_plan_pro', 'PUT', '/test-plan', {
        token: r5,
        body: { plan: 'PRO' }
    });
    check('ro_pro_active', ro_pro?.plan_state === 'active', ro_pro);
    const ra = await call(
        'ro_table_a',
        'POST',
        '/file-directory',
        new_table(r5, r5_me?.id, 'smoke_ro_a')
    );
    const rb = await call(
        'ro_table_b',
        'POST',
        '/file-directory',
        new_table(r5, r5_me?.id, 'smoke_ro_b')
    );
    await call('ro_rows_a', 'POST', `/web-file/batch_create/data_grid_row/${ra}`, {
        token: r5,
        body: [{ a: 'x' }, { a: 'y' }]
    });
    const r_form = await call('ro_form', 'POST', '/form', {
        token: r5,
        body: { file_id: ra, title: 'smoke ro form', fields: [{ field: 'a' }] }
    });
    const r_key = await call('ro_key', 'POST', '/api-key', {
        token: r5,
        body: { name: 'smoke ro', access: 'read_write' }
    });
    const rv1 = (path, init = {}) =>
        fetch(`${BASE}/api/v1/${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${r_key?.secret}`,
                'Content-Type': 'application/json'
            }
        }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
    const ru_pro = await call('ro_usage_pro', 'GET', '/usage', { token: r5 });
    const rows_a = (ru_pro?.tables || []).find(t => t.id === ra)?.rows ?? 0;
    check('ro_table_a_has_rows', rows_a >= 2, ru_pro);

    // The downgrade: 1 table (it has 2) and one row fewer than table A has
    const ro_free = await call('ro_test_plan_free', 'PUT', '/test-plan', {
        token: r5,
        body: {
            plan: 'FREE',
            caps: {
                tables: 1,
                rows_per_account: rows_a - 1,
                api_rate_per_second: 100,
                api_rate_burst: 100
            }
        }
    });
    check(
        'ro_downgrade_read_only',
        ro_free?.plan_state === 'read_only' &&
            ro_free?.over?.includes('tables') &&
            ro_free?.over?.includes('rows_per_account'),
        ro_free
    );
    const ru_ro = await call('ro_usage_read_only', 'GET', '/usage', { token: r5 });
    check(
        'ro_usage_shows_state',
        ru_ro?.plan_state === 'read_only' && ru_ro?.over?.includes('tables'),
        ru_ro
    );
    const r5_me_ro = await call('ro_authorize_read_only', 'GET', `/auth/authorize?token=${r5}`);
    check(
        'ro_authorize_shows_state',
        r5_me_ro?.plan_state === 'read_only' && r5_me_ro?.locked !== true,
        r5_me_ro
    );

    // Reads and the export work
    const ro_rows = await call(
        'ro_read_app',
        'POST',
        `/web-file/data_grid_row/${ra}?skip=0&limit=10`,
        {
            token: r5,
            body: {}
        }
    );
    const ro_row = ro_rows?.data?.[0];
    check('ro_read_app_rows', !!ro_row?._id, ro_rows);
    results.ro_read_api = await rv1('get?table=smoke_ro_a&skip=0&limit=5');
    check('ro_read_api_200', results.ro_read_api.status === 200, results.ro_read_api);
    results.ro_query_api = await rv1('query?table=smoke_ro_a', {
        method: 'POST',
        body: JSON.stringify({ limit: 5 })
    });
    check('ro_query_api_200', results.ro_query_api.status === 200, results.ro_query_api);
    results.ro_export = await fetch(`${BASE}/account-export`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${r5}` }
    }).then(async r => ({ status: r.status, data: await r.json().catch(() => null) }));
    // 409/429: an export already running, or the day's exports used (a rerun): not the read-only state
    check(
        'ro_export_allowed',
        results.ro_export.status < 300 || [409, 429].includes(results.ro_export.status),
        results.ro_export
    );

    // Every write path is refused
    await call('ro_app_create_row', 'POST', `/web-file/batch_create/data_grid_row/${ra}`, {
        token: r5,
        body: [{ a: 'z' }],
        expectFail: true
    });
    read_only_is('ro_app_create_row');
    await call('ro_app_update_row', 'PUT', `/web-file/${ro_row?._id}/data_grid_row/${ra}`, {
        token: r5,
        body: { ...ro_row, a: 'changed' },
        expectFail: true
    });
    read_only_is('ro_app_update_row');
    await call('ro_app_batch_update_rows', 'PUT', `/web-file/batch_update/data_grid_row/${ra}`, {
        token: r5,
        body: [{ ...ro_row, a: 'changed' }],
        expectFail: true
    });
    read_only_is('ro_app_batch_update_rows');
    await call('ro_app_new_column', 'GET', `/web-file/${ra}/get_new_column`, {
        token: r5,
        expectFail: true
    });
    read_only_is('ro_app_new_column');
    await call('ro_app_create_column', 'POST', `/web-file/batch_create/data_grid_column/${ra}`, {
        token: r5,
        body: [{ file_directory_id: ra, col_index: 9, order: 9, field: 'i', headerName: 'col9' }],
        expectFail: true
    });
    read_only_is('ro_app_create_column');
    const ro_cols = await call(
        'ro_read_columns',
        'POST',
        `/web-file/data_grid_column/${ra}?skip=0&limit=50`,
        { token: r5, body: {} }
    );
    const ro_col = (ro_cols?.data || []).find(c => !c.deleted);
    await call('ro_app_rename_column', 'PUT', `/web-file/batch_update/data_grid_column/${ra}`, {
        token: r5,
        body: [{ ...ro_col, headerName: 'renamed' }],
        expectFail: true
    });
    read_only_is('ro_app_rename_column');
    await call('ro_new_table', 'POST', '/file-directory', {
        ...new_table(r5, r5_me?.id, 'smoke_ro_c'),
        expectFail: true
    });
    read_only_is('ro_new_table');
    await call('ro_template', 'POST', '/table-template/waitlist', {
        token: r5,
        body: { name: 'smoke_ro_tpl' },
        expectFail: true
    });
    read_only_is('ro_template');
    await call('ro_csv_upload', 'POST', '/web-file/file_upload', {
        token: r5,
        form: csv_form('smoke_ro_csv', 'x,y\n1,2\n'),
        expectFail: true
    });
    read_only_is('ro_csv_upload');
    await call('ro_url_import', 'POST', '/url-import', {
        token: r5,
        body: { new_name: 'smoke_ro_url', url: `${RAW}/examples/data/todo.csv` },
        expectFail: true
    });
    read_only_is('ro_url_import');
    // The MCP server's table and column tools (#329): the read-only state as a tool error
    for (const [n, tool, args] of [
        [
            'ro_mcp_create_table',
            'create_table',
            { name: 'smoke_ro_mcp', columns: [{ name: 'A', type: 'string' }] }
        ],
        [
            'ro_mcp_add_columns',
            'add_columns',
            { table: 'smoke_ro_a', columns: [{ name: 'B', type: 'string' }] }
        ]
    ]) {
        const res = await mcp_tool(n, r_key?.secret, tool, args);
        check(
            `${n}_read_only`,
            res?.isError === true && /plan_read_only/.test(res?.content?.[0]?.text || ''),
            res
        );
    }
    results.ro_api_create = await rv1('create?table=smoke_ro_a', {
        method: 'POST',
        body: JSON.stringify([{ column1: 'x' }])
    });
    read_only_is('ro_api_create');
    results.ro_api_update = await rv1('update?table=smoke_ro_a', {
        method: 'PUT',
        body: JSON.stringify([{ _id: ro_row?._id, column1: 'changed' }])
    });
    read_only_is('ro_api_update');
    await call('ro_new_form', 'POST', '/form', {
        token: r5,
        body: { file_id: ra, title: 'smoke ro form 2', fields: [{ field: 'a' }] },
        expectFail: true
    });
    read_only_is('ro_new_form');
    await call('ro_new_view', 'POST', '/view', {
        token: r5,
        body: { file_id: ra, name: 'smoke ro view', type: 'grid' },
        expectFail: true
    });
    read_only_is('ro_new_view');
    await call('ro_new_webhook', 'POST', '/webhook', {
        token: r5,
        body: { url: `http://${HOOK_HOST}/ro`, events: ['row.updated'], file_id: ra },
        expectFail: true
    });
    read_only_is('ro_new_webhook');
    await call('ro_form_submit', 'POST', `/public/form/${r_form?.id}/submit`, {
        body: { values: { a: 'x' }, website: '' },
        expectFail: true
    });
    status_is('ro_form_submit', 403);

    // Deletes work. One row less: still over (2 tables), still read-only
    results.ro_api_delete = await rv1('delete?table=smoke_ro_a', {
        method: 'POST',
        body: JSON.stringify([ro_row?._id])
    });
    // POST /api/v1/delete answers 201 (no @HttpCode), with the count deleted
    check(
        'ro_api_delete_ok',
        results.ro_api_delete.status < 300 && results.ro_api_delete.data === 1,
        results.ro_api_delete
    );
    results.ro_api_create_still = await rv1('create?table=smoke_ro_a', {
        method: 'POST',
        body: JSON.stringify([{ column1: 'x' }])
    });
    read_only_is('ro_api_create_still');
    // Table B goes: 1 table, and table A at the row cap. Under the caps: writable again
    await call('ro_delete_table_b', 'POST', '/file-directory/batch_delete', {
        token: r5,
        body: { ids: [rb] }
    });
    const ru_back = await call('ro_usage_after_delete', 'GET', '/usage', { token: r5 });
    check(
        'ro_under_caps_active',
        ru_back?.plan_state === 'active' && (ru_back?.over || []).length === 0,
        ru_back
    );
    const ro_rows_after = await call(
        'ro_read_after_delete',
        'POST',
        `/web-file/data_grid_row/${ra}?skip=0&limit=10`,
        { token: r5, body: {} }
    );
    const ro_row2 = ro_rows_after?.data?.[0];
    await call('ro_app_update_after', 'PUT', `/web-file/${ro_row2?._id}/data_grid_row/${ra}`, {
        token: r5,
        body: { ...ro_row2, a: 'writable again' }
    });
    results.ro_api_update_after = await rv1('update?table=smoke_ro_a', {
        method: 'PUT',
        body: JSON.stringify([{ _id: ro_row2?._id, column1: 'writable again' }])
    });
    check(
        'ro_api_update_after_200',
        results.ro_api_update_after.status === 200,
        results.ro_api_update_after
    );
    // At the row cap, a new row is an ordinary plan_limit, not the read-only state
    results.ro_api_create_at_cap = await rv1('create?table=smoke_ro_a', {
        method: 'POST',
        body: JSON.stringify([{ column1: 'x' }])
    });
    plan_limit_is('ro_api_create_at_cap', 'rows_per_account');
    // At the table cap (1), MCP's create_table answers the plan_limit as a tool error and makes
    // nothing (#329)
    const ro_mcp_at_cap = await mcp_tool('ro_mcp_table_at_cap', r_key?.secret, 'create_table', {
        name: 'smoke_ro_mcp',
        columns: [{ name: 'A', type: 'string' }]
    });
    const ro_mcp_cap_text = ro_mcp_at_cap?.content?.[0]?.text || '';
    check(
        'ro_mcp_table_at_cap_plan_limit',
        ro_mcp_at_cap?.isError === true &&
            /plan_limit/.test(ro_mcp_cap_text) &&
            /"limit":"tables"/.test(ro_mcp_cap_text),
        ro_mcp_at_cap
    );
    const ro_dirs_cap = await call('ro_mcp_table_at_cap_dirs', 'GET', '/file-directory', {
        token: r5
    });
    check(
        'ro_mcp_table_at_cap_made_nothing',
        Array.isArray(ro_dirs_cap) && !ro_dirs_cap.some(d => d.name === 'smoke_ro_mcp'),
        ro_dirs_cap
    );
    await call('ro_test_plan_reset', 'DELETE', '/test-plan', { token: r5 });
    await plan_cleanup('ro_end', r5);
    await call('ro_logout', 'GET', `/auth/logout?token=${r5}`);
}

// Two-factor sign-in (#214) on demo6: set up with a QR code and a code, then the password login
// asks for a code; used codes (TOTP steps and recovery codes) are refused; demo2 and API keys
// can't touch it; turned off with a recovery code. The service allows 10 code attempts per
// account per hour, so this uses 8.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function totp_at(secret, step) {
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const c of secret.toUpperCase()) {
        value = ((value << 5) | B32.indexOf(c)) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 0xff);
            bits -= 8;
        }
    }
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(step));
    const h = crypto.createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
    const o = h[h.length - 1] & 0x0f;
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
const tf_step = () => Math.floor(Date.now() / 30000);
const tf_creds = { email: 'demo6@invokedb.com', password: 'password' };
const tf_session = await call('two_factor_login_off', 'POST', '/auth/login', { body: tf_creds });
const tf_token = tf_session?.token;
check('two_factor_off_login_is_session', !!tf_token && !tf_session.two_factor_required, tf_session);
const tf_status0 = await call('two_factor_status', 'GET', '/two-factor', { token: tf_token });
check(
    'two_factor_status_off',
    tf_status0?.available === true && tf_status0.enabled === false && tf_status0.password_account,
    tf_status0
);
// The admin area (#277): demo6 is on smoke-env.sh's HORIZON_ADMIN_EMAILS, but without two-factor
// on it's no admin yet: 404, like everyone else
await call('admin_before_two_factor', 'GET', '/admin/overview', {
    token: tf_token,
    expectFail: true
});
check('admin_before_two_factor_404', results.admin_before_two_factor?.status === 404);
await call('two_factor_status_api_key', 'GET', '/two-factor', { token: key, expectFail: true });
await call('two_factor_status_no_auth', 'GET', '/two-factor', { expectFail: true });
const tf_setup = await call('two_factor_setup', 'POST', '/two-factor/setup', { token: tf_token });
const tf_secret = tf_setup?.secret;
check(
    'two_factor_setup_qr',
    typeof tf_secret === 'string' &&
        /^[A-Z2-7]{32}$/.test(tf_secret) &&
        tf_setup.qr_code?.startsWith('data:image/svg+xml;base64,') &&
        decodeURIComponent(tf_setup.otpauth_url || '').startsWith(
            'otpauth://totp/InvokeDB:demo6@invokedb.com?'
        ),
    { qr: tf_setup?.qr_code?.slice(0, 30), url: tf_setup?.otpauth_url?.slice(0, 40) }
);
const tf_enable_step = tf_step();
const tf_enable_code = totp_at(tf_secret, tf_enable_step);
const tf_enabled = await call('two_factor_enable', 'POST', '/two-factor/enable', {
    token: tf_token,
    body: { code: tf_enable_code }
});
const tf_recovery = tf_enabled?.recovery_codes || [];
check(
    'two_factor_enable_recovery_codes',
    tf_enabled?.enabled === true &&
        tf_recovery.length === 10 &&
        tf_recovery.every(c => /^[a-z2-7]{4}(-[a-z2-7]{4}){3}$/.test(c)),
    { enabled: tf_enabled?.enabled, count: tf_recovery.length }
);
await call('two_factor_setup_when_on', 'POST', '/two-factor/setup', {
    token: tf_token,
    expectFail: true
});

// The admin area (#277), now that demo6 (on HORIZON_ADMIN_EMAILS) has two-factor on. Anyone
// else gets 404: another account, an API key, no token. The actions run on a new account made
// here, deleted at the end through the admin area.
for (const [name, tok] of [
    ['admin_non_admin', token],
    ['admin_api_key', key],
    ['admin_no_auth', undefined]
]) {
    await call(name, 'GET', '/admin/overview', { token: tok, expectFail: true });
    check(`${name}_404`, results[name]?.status === 404, results[name]);
    await call(`${name}_accounts`, 'GET', '/admin/accounts', { token: tok, expectFail: true });
    check(`${name}_accounts_404`, results[`${name}_accounts`]?.status === 404);
}
await call('admin_non_admin_action', 'POST', '/admin/accounts/1/lock', {
    token,
    body: {},
    expectFail: true
});
check('admin_non_admin_action_404', results.admin_non_admin_action?.status === 404);
const adm_me = await call('admin_authorize', 'GET', `/auth/authorize?token=${tf_token}`);
check('admin_authorize_flag', adm_me?.admin === true && me?.admin === false, {
    admin: adm_me?.admin,
    demo: me?.admin
});
// Made before the first admin read: the list is a snapshot, a few minutes old at most
const adm_email = `smoke-admin-${crypto.randomUUID().slice(0, 8)}@example.com`;
await call('admin_target_signup', 'POST', '/auth/create-account', {
    body: { email: adm_email, password: signup_password }
});
const adm_target_session = await call('admin_target_login', 'POST', '/auth/login', {
    body: { email: adm_email, password: signup_password }
});
const adm_target_token = adm_target_session?.token;
const adm_overview = await call('admin_overview', 'GET', '/admin/overview', { token: tf_token });
check(
    'admin_overview_figures',
    adm_overview?.signups?.length === 30 &&
        adm_overview.signups.reduce((s, d) => s + d.count, 0) >= 1 &&
        adm_overview.accounts >= 7 &&
        typeof adm_overview.active?.days_7 === 'number' &&
        typeof adm_overview.plans?.INTERNAL === 'number' &&
        adm_overview.ai?.budget_usd === 5 &&
        typeof adm_overview.ai?.spent_usd === 'number' &&
        typeof adm_overview.e2e?.conclusion === 'string',
    adm_overview
);
const adm_search0 = await call(
    'admin_accounts_demo2',
    'GET',
    '/admin/accounts?search=demo2%40invokedb.com&sort=email&dir=asc',
    { token: tf_token }
);
const adm_demo2 = adm_search0?.accounts?.[0];
check(
    'admin_accounts_search',
    adm_search0?.total === 1 &&
        adm_demo2?.email === 'demo2@invokedb.com' &&
        adm_demo2.plan === 'INTERNAL' &&
        typeof adm_demo2.rows === 'number' &&
        typeof adm_demo2.storage_bytes === 'number' &&
        Array.isArray(adm_demo2.caps),
    adm_search0
);
await call('admin_accounts_bad_sort', 'GET', '/admin/accounts?sort=password_hash', {
    token: tf_token,
    expectFail: true
});
check('admin_accounts_bad_sort_400', results.admin_accounts_bad_sort?.status === 400);
// demo7 is on Free with tiny caps (HORIZON_TEST_PLANS): earlier tests filled them
const adm_over = await call(
    'admin_accounts_over',
    'GET',
    '/admin/accounts?caps=flagged&limit=100',
    {
        token: tf_token
    }
);
check(
    'admin_accounts_over_caps',
    Array.isArray(adm_over?.accounts) &&
        adm_over.accounts.every(a => a.caps.length > 0) &&
        adm_over.accounts.some(a => a.email === 'demo7@invokedb.com'),
    adm_over && adm_over.accounts?.map(a => [a.email, a.caps])
);
const adm_detail = await call('admin_account_demo', 'GET', `/admin/accounts/${me.id}`, {
    token: tf_token
});
check(
    'admin_account_detail',
    adm_detail?.account?.email === 'demo@invokedb.com' &&
        adm_detail.tables?.some(
            t => String(t.id) === String(file_id) && t.rows > 0 && t.size_bytes >= 0
        ) &&
        adm_detail.api_keys?.length > 0 &&
        adm_detail.api_keys.every(k => typeof k.prefix === 'string' && !('key_hash' in k)) &&
        Array.isArray(adm_detail.history) &&
        typeof adm_detail.ai?.cost_usd === 'number' &&
        typeof adm_detail.usage?.tables?.used === 'number',
    adm_detail && { account: adm_detail.account, tables: adm_detail.tables }
);
check(
    'admin_account_detail_no_rows_or_keys',
    !!adm_detail &&
        !JSON.stringify(adm_detail).includes('alice') &&
        !(key && JSON.stringify(adm_detail).includes(key))
);
await call('admin_account_unknown', 'GET', '/admin/accounts/99999999', {
    token: tf_token,
    expectFail: true
});
await call('admin_own_account_action', 'POST', `/admin/accounts/${adm_me?.id}/lock`, {
    token: tf_token,
    body: {},
    expectFail: true
});
const adm_found = await call(
    'admin_accounts_target',
    'GET',
    `/admin/accounts?search=${encodeURIComponent(adm_email)}`,
    { token: tf_token }
);
const adm_id = adm_found?.accounts?.[0]?.id;
check(
    'admin_target_listed',
    !!adm_id &&
        adm_found.accounts[0].verified === false &&
        adm_found.accounts[0].plan === 'FREE' &&
        typeof adm_found.accounts[0].created_at === 'number',
    adm_found
);
const adm_path = `/admin/accounts/${adm_id}`;
await call('admin_plan_bad', 'POST', `${adm_path}/plan`, {
    token: tf_token,
    body: { plan: 'GOLD' },
    expectFail: true
});
await call('admin_plan_starter', 'POST', `${adm_path}/plan`, {
    token: tf_token,
    body: { plan: 'STARTER' }
});
const adm_after_plan = await call('admin_target_after_plan', 'GET', adm_path, { token: tf_token });
check('admin_plan_changed', adm_after_plan?.account?.plan === 'STARTER', adm_after_plan?.account);
await call('admin_plan_internal', 'POST', `${adm_path}/plan`, {
    token: tf_token,
    body: { plan: 'INTERNAL' }
});
const adm_usage_internal = await call('admin_target_usage', 'GET', '/usage', {
    token: adm_target_token
});
check(
    'admin_plan_internal_no_caps',
    adm_usage_internal?.internal === true && adm_usage_internal.usage?.tables?.cap === null,
    adm_usage_internal
);
await call('admin_lock', 'POST', `${adm_path}/lock`, {
    token: tf_token,
    body: { reason: 'Smoke test lock' }
});
const adm_locked = await call(
    'admin_target_authorize_locked',
    'GET',
    `/auth/authorize?token=${adm_target_token}`
);
check(
    'admin_lock_shown_to_account',
    adm_locked?.locked === true && adm_locked.locked_reason === 'Smoke test lock',
    adm_locked
);
await call('admin_unlock', 'POST', `${adm_path}/unlock`, { token: tf_token });
await call('admin_unlock_again', 'POST', `${adm_path}/unlock`, {
    token: tf_token,
    expectFail: true
});
check('admin_unlock_again_409', results.admin_unlock_again?.status === 409);
await call('admin_resend_verification', 'POST', `${adm_path}/resend-verification`, {
    token: tf_token
});
await call('admin_reset_two_factor_off', 'POST', `${adm_path}/reset-two-factor`, {
    token: tf_token,
    expectFail: true
});
check('admin_reset_two_factor_off_409', results.admin_reset_two_factor_off?.status === 409);
// The account's own history shows each action, with the admin as the actor
const adm_history = await call('admin_target_history', 'GET', '/audit', {
    token: adm_target_token
});
const adm_actions = (adm_history?.entries || [])
    .filter(e => e.actor?.type === 'admin' && e.source === 'admin')
    .map(e => e.action);
check(
    'admin_actions_in_history',
    ['admin.plan_changed', 'admin.locked', 'admin.unlocked', 'admin.verification_sent'].every(a =>
        adm_actions.includes(a)
    ) &&
        adm_history.entries.every(
            e => e.actor?.type !== 'admin' || e.actor.label.includes('demo6@invokedb.com')
        ),
    adm_history
);
await call('admin_delete_unconfirmed', 'POST', `${adm_path}/delete`, {
    token: tf_token,
    body: { confirm: 'someone@else.com' },
    expectFail: true
});
check('admin_delete_unconfirmed_400', results.admin_delete_unconfirmed?.status === 400);
const adm_before_delete = await account_leftovers(adm_id);
await call('admin_delete', 'POST', `${adm_path}/delete`, {
    token: tf_token,
    body: { confirm: adm_email.toUpperCase() }
});
// The admin's delete is the user's own: the account's data goes at once (#279)
if (adm_id) await check_account_data_gone('admin_delete', adm_id, adm_before_delete);
await call('admin_deleted_detail', 'GET', adm_path, { token: tf_token, expectFail: true });
check('admin_deleted_detail_404', results.admin_deleted_detail?.status === 404);
await call('admin_deleted_session_ended', 'GET', '/file-directory', {
    token: adm_target_token,
    expectFail: true
});
await call('admin_deleted_login', 'POST', '/auth/login', {
    body: { email: adm_email, password: signup_password },
    expectFail: true
});

// Error tracking and the status page (#212). The frontend posts its errors to the public
// POST /errors; the admin's Errors page lists them grouped, scrubbed of emails and tokens.
const err_tag = crypto.randomUUID().slice(0, 8);
const err_session = `smoke-${err_tag}`;
const err_report = {
    message: `Smoke error ${err_tag} for someone@example.com`,
    stack: `TypeError: Smoke error\n    at save (https://invokedb.test/assets/home-AbC12345.js:1:${err_tag.length})`,
    page: '/app/reset-password?token=should-not-be-kept',
    kind: 'vue',
    info: 'mounted hook',
    session: err_session
};
await call('errors_report', 'POST', '/errors', { body: err_report });
check('errors_report_202', results.errors_report?.status === 202, results.errors_report);
await call('errors_report_again', 'POST', '/errors', { body: err_report, token });
await call('errors_report_no_message', 'POST', '/errors', {
    body: { stack: 'x', session: err_session },
    expectFail: true
});
check('errors_report_no_message_400', results.errors_report_no_message?.status === 400);
await call('errors_list_non_admin', 'GET', '/admin/errors', { token, expectFail: true });
check('errors_list_non_admin_404', results.errors_list_non_admin?.status === 404);
const err_list = await call('errors_list', 'GET', '/admin/errors?source=frontend&limit=100', {
    token: tf_token
});
const err_group = (err_list?.errors || []).find(e => e.message.includes(err_tag));
check(
    'errors_grouped_and_scrubbed',
    !!err_group &&
        err_group.count === 2 &&
        err_group.source === 'frontend' &&
        err_group.page === '/app/reset-password' &&
        err_group.route === 'mounted hook' &&
        err_group.account_id === me.id &&
        !err_group.message.includes('someone@example.com') &&
        !('stack' in err_group),
    err_group || err_list
);
const err_detail = await call('errors_detail', 'GET', `/admin/errors/${err_group?.id}`, {
    token: tf_token
});
check(
    'errors_detail_stack',
    typeof err_detail?.stack === 'string' && err_detail.stack.includes('home-AbC12345.js'),
    err_detail
);
await call('errors_detail_unknown', 'GET', `/admin/errors/${'0'.repeat(24)}`, {
    token: tf_token,
    expectFail: true
});
await call('errors_list_bad_source', 'GET', '/admin/errors?source=db', {
    token: tf_token,
    expectFail: true
});
// A page session gets 10 reports per 10 minutes (two used above, the 400 too)
for (let i = 0; i < 8; i++) {
    await fetch(`${BASE}/errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...err_report, message: `${err_report.message} ${i}` })
    });
}
await call('errors_report_rate_limited', 'POST', '/errors', { body: err_report, expectFail: true });
check('errors_report_rate_limited_429', results.errors_report_rate_limited?.status === 429);

const status = await call('status', 'GET', '/status');
const status_check = id => (status?.checks || []).find(c => c.id === id);
// The E2E check is production's latest run, read from GitHub: a failed one makes it degraded
check(
    'status_checks',
    (status?.status === 'operational' || status_check('e2e')?.state === 'degraded') &&
        status_check('api')?.state === 'operational' &&
        status_check('database')?.state === 'operational' &&
        status_check('processor')?.state === 'operational' &&
        !!status_check('e2e') &&
        status.incident === null,
    status
);
await call('status_incident_non_admin', 'POST', '/admin/status/incident', {
    token,
    body: { message: 'x' },
    expectFail: true
});
await call('status_incident_bad', 'POST', '/admin/status/incident', {
    token: tf_token,
    body: { message: 'x', level: 'bad' },
    expectFail: true
});
await call('status_incident_set', 'POST', '/admin/status/incident', {
    token: tf_token,
    body: { message: 'Smoke test: imports are slow', level: 'degraded' }
});
const status_incident = await call('status_with_incident', 'GET', '/status');
check(
    'status_incident_shown',
    status_incident?.status === 'degraded' &&
        status_incident.incident?.message === 'Smoke test: imports are slow' &&
        status_incident.incident.level === 'degraded',
    status_incident
);
await call('status_incident_clear', 'POST', '/admin/status/incident/clear', { token: tf_token });
const status_cleared = await call('status_cleared', 'GET', '/status');
check('status_incident_cleared', status_cleared?.incident === null, status_cleared);
// demo2 has its own (off) two-factor and can't turn demo6's off, even with demo6's code
// (a fresh sign-in: the first demo2 session was logged out earlier)
const tf_other_login = await call('two_factor_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const tf_otoken = tf_other_login?.token;
const tf_other = await call('two_factor_other_status', 'GET', '/two-factor', { token: tf_otoken });
check('two_factor_other_is_own', tf_other?.enabled === false, tf_other);
await call('two_factor_other_disable', 'POST', '/two-factor/disable', {
    token: tf_otoken,
    body: { code: tf_recovery[0] },
    expectFail: true
});
await call('two_factor_other_logout', 'GET', `/auth/logout?token=${tf_otoken}`);
// The password alone no longer signs in
const tf_login1 = await call('two_factor_login_challenge', 'POST', '/auth/login', {
    body: tf_creds
});
check(
    'two_factor_login_no_session',
    tf_login1?.two_factor_required === true && !tf_login1.token && !!tf_login1.challenge,
    tf_login1
);
await call('two_factor_login_wrong_password', 'POST', '/auth/login', {
    body: { ...tf_creds, password: 'nope' },
    expectFail: true
});
await call('two_factor_login_bad_challenge', 'POST', '/auth/login/two-factor', {
    body: { challenge: 'nope', code: tf_enable_code },
    expectFail: true
});
// The code that turned it on can't be used again (replay)
await call('two_factor_login_replay', 'POST', '/auth/login/two-factor', {
    body: { challenge: tf_login1?.challenge, code: tf_enable_code },
    expectFail: true
});
// The next step's code is within the allowed drift and hasn't been used
const tf_next_code = totp_at(tf_secret, tf_enable_step + 1);
const tf_signed = await call('two_factor_login_code', 'POST', '/auth/login/two-factor', {
    body: { challenge: tf_login1?.challenge, code: tf_next_code }
});
const tf_me = await call(
    'two_factor_login_authorize',
    'GET',
    `/auth/authorize?token=${tf_signed?.token}`
);
check('two_factor_login_is_demo6', tf_me?.email === 'demo6@invokedb.com', tf_me);
await call('two_factor_login_challenge_used', 'POST', '/auth/login/two-factor', {
    body: { challenge: tf_login1?.challenge, code: tf_next_code },
    expectFail: true
});
const tf_login2 = await call('two_factor_login_challenge2', 'POST', '/auth/login', {
    body: tf_creds
});
await call('two_factor_login_code_replay', 'POST', '/auth/login/two-factor', {
    body: { challenge: tf_login2?.challenge, code: tf_next_code },
    expectFail: true
});
const tf_by_recovery = await call('two_factor_login_recovery', 'POST', '/auth/login/two-factor', {
    body: { challenge: tf_login2?.challenge, code: tf_recovery[1].toUpperCase() }
});
check('two_factor_login_recovery_session', !!tf_by_recovery?.token, tf_by_recovery);
const tf_login3 = await call('two_factor_login_challenge3', 'POST', '/auth/login', {
    body: tf_creds
});
await call('two_factor_login_recovery_reused', 'POST', '/auth/login/two-factor', {
    body: { challenge: tf_login3?.challenge, code: tf_recovery[1] },
    expectFail: true
});
const tf_status1 = await call('two_factor_status_on', 'GET', '/two-factor', { token: tf_token });
check(
    'two_factor_status_on_codes_left',
    tf_status1?.enabled === true && tf_status1.recovery_codes_left === 9,
    tf_status1
);
await call('two_factor_disable_no_code', 'POST', '/two-factor/disable', {
    token: tf_token,
    body: {},
    expectFail: true
});
await call('two_factor_disable', 'POST', '/two-factor/disable', {
    token: tf_token,
    body: { code: tf_recovery[2] }
});
const tf_login4 = await call('two_factor_login_off_again', 'POST', '/auth/login', {
    body: tf_creds
});
check(
    'two_factor_off_again_is_session',
    !!tf_login4?.token && !tf_login4.two_factor_required,
    tf_login4
);
for (const t of [tf_token, tf_signed?.token, tf_by_recovery?.token, tf_login4?.token]) {
    if (t) await fetch(`${BASE}/auth/logout?token=${t}`);
}

// Data export (#215): the processor writes a zip of every table (CSV and JSON) and the forms,
// views and webhooks settings (no webhook secrets); only demo can download it; demo2 and API
// keys are locked out. A webhook with a secret is made first, to check it's left out.
const exp_hook = await call('export_webhook_create', 'POST', '/webhook', {
    token,
    body: { url: `http://${HOOK_HOST}/export`, events: ['row.created'], file_id }
});
await call('export_api_key', 'POST', '/account-export', { token: key, expectFail: true });
const exp_req = await call('export_request', 'POST', '/account-export', { token });
const exp_id = exp_req?.export?.id;
check('export_request_pending', exp_req?.export?.status === 'pending' && !!exp_id, exp_req);
await call('export_request_again', 'POST', '/account-export', { token, expectFail: true });
check('export_request_again_409', results.export_request_again?.status === 409);
const exp_other = await call('export_other_login', 'POST', '/auth/login', {
    body: { email: 'demo2@invokedb.com', password: 'password' }
});
const exp_otoken = exp_other?.token;
const exp_other_status = await call('export_other_status', 'GET', '/account-export', {
    token: exp_otoken
});
check('export_other_status_not_demos', exp_other_status?.export?.id !== exp_id, exp_other_status);
let exp_status = null;
for (let i = 0; i < 60; i++) {
    const res = await fetch(`${BASE}/account-export`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    exp_status = (await res.json())?.export;
    if (exp_status && !['pending', 'running'].includes(exp_status.status)) break;
    await sleep(1000);
}
results.export_status = exp_status;
check(
    'export_ready',
    exp_status?.id === exp_id &&
        exp_status?.status === 'ready' &&
        exp_status?.expires_at - exp_status?.finished_at === 24 * 3600 * 1000 &&
        exp_status?.size > 0 &&
        exp_status?.tables >= 1,
    exp_status
);
await call('export_other_download', 'GET', `/account-export/${exp_id}/download`, {
    token: exp_otoken,
    expectFail: true
});
check('export_other_download_404', results.export_other_download?.status === 404);
await call('export_api_key_download', 'GET', `/account-export/${exp_id}/download`, {
    token: key,
    expectFail: true
});
await call('export_unknown_download', 'GET', `/account-export/${crypto.randomUUID()}/download`, {
    token,
    expectFail: true
});
await call('export_bad_id_download', 'GET', '/account-export/..%2F..%2Fx/download', {
    token,
    expectFail: true
});
await call('export_other_logout', 'GET', `/auth/logout?token=${exp_otoken}`);

// Reads a zip: the end record, the central directory, then each entry's deflated data
function read_zip(buf) {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error('no end of central directory');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    const entries = {};
    for (let i = 0; i < count; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
        const crc = buf.readUInt32LE(p + 16);
        const csize = buf.readUInt32LE(p + 20);
        const name_len = buf.readUInt16LE(p + 28);
        const skip = name_len + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
        const offset = buf.readUInt32LE(p + 42);
        const name = buf.subarray(p + 46, p + 46 + name_len).toString('utf8');
        const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
        const data = zlib.inflateRawSync(buf.subarray(start, start + csize));
        if (zlib.crc32(data) !== crc) throw new Error(`bad CRC for ${name}`);
        entries[name] = data.toString('utf8');
        p += 46 + skip;
    }
    return entries;
}
let exp_zip = null;
try {
    const res = await fetch(`${BASE}/account-export/${exp_id}/download`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const buf = Buffer.from(await res.arrayBuffer());
    results.export_download = {
        status: res.status,
        type: res.headers.get('content-type'),
        disposition: res.headers.get('content-disposition'),
        bytes: buf.length
    };
    if (res.ok) exp_zip = read_zip(buf);
} catch (ex) {
    results.export_download = { error: ex.message };
}
check(
    'export_download',
    results.export_download?.status === 200 &&
        results.export_download?.type === 'application/zip' &&
        /attachment; filename="invokedb-export-\d{4}-\d{2}-\d{2}\.zip"/.test(
            results.export_download?.disposition || ''
        ) &&
        results.export_download?.bytes === exp_status?.size,
    results.export_download
);
const exp_files = Object.keys(exp_zip || {});
results.export_zip_files = exp_files;
const exp_manifest = exp_zip?.['manifest.json'] ? JSON.parse(exp_zip['manifest.json']) : null;
const exp_people = exp_manifest?.tables?.find(t => t.id === file_id);
check(
    'export_zip_has_every_table',
    !!exp_manifest &&
        exp_manifest.tables.length === exp_status?.tables &&
        exp_manifest.tables.every(t => exp_files.includes(t.csv) && exp_files.includes(t.json)) &&
        ['forms.json', 'views.json', 'webhooks.json'].every(f => exp_files.includes(f)),
    { exp_files, exp_manifest }
);
// smoke_people as it is now: every row, through the API
const exp_count = await call('export_people_count', 'POST', COUNT, { token: key, body: {} });
const exp_api_rows = await call(
    'export_people_rows',
    'GET',
    `/api/v1/get?table=smoke_people&skip=0&limit=${exp_count?.count || 1}`,
    { token: key }
);
const exp_csv = exp_people ? exp_zip[exp_people.csv] : '';
const exp_csv_lines = exp_csv.split('\r\n').filter(Boolean);
const exp_json = exp_people ? JSON.parse(exp_zip[exp_people.json]) : null;
check(
    'export_table_csv',
    exp_people?.name === 'smoke_people' &&
        exp_people?.rows === exp_count?.count &&
        exp_csv_lines[0]?.startsWith('_id,') &&
        exp_csv_lines[0]?.split(',').includes('age') &&
        exp_csv_lines.length === exp_count?.count + 1,
    { exp_count, csv: exp_csv.slice(0, 300) }
);
const exp_ages = rows_ =>
    (rows_ || [])
        .map(r => `${r._id}:${r.age}`)
        .sort()
        .join(',');
check(
    'export_table_json',
    exp_json?.name === 'smoke_people' &&
        exp_json?.columns?.find(c => c.name === 'age')?.type === 'number' &&
        exp_json?.rows?.length === exp_count?.count &&
        exp_json?.rows?.every(r => typeof r._id === 'string' && 'age' in r) &&
        exp_ages(exp_json?.rows) === exp_ages(exp_api_rows?.data),
    exp_json && { columns: exp_json.columns, rows: exp_json.rows?.slice(0, 3) }
);
const exp_hooks = exp_zip?.['webhooks.json'] ? JSON.parse(exp_zip['webhooks.json']) : [];
check(
    'export_webhooks_without_secrets',
    exp_hooks.some(h => h.id === exp_hook?.id && h.table === 'smoke_people') &&
        !exp_zip['webhooks.json'].includes('whsec_') &&
        exp_hooks.every(h => !('secret' in h) && !('account_id' in h)),
    exp_hooks
);
check(
    'export_no_secrets_anywhere',
    !!exp_zip &&
        Object.values(exp_zip).every(
            text => !text.includes('whsec_') && !(key && text.includes(key))
        )
);
await call('export_webhook_delete', 'DELETE', `/webhook/${exp_hook?.id}`, { token });

await call('support', 'POST', '/support/request', {
    token,
    body: { email: 'x@y.z', message: 'smoke' }
});
await call('file_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [file_id] }
});
// The keys this test made for demo (#138); revoked, they stop working at once
for (const [i, k] of smoke_keys.filter(k => k.owner === token).entries()) {
    await call(`api_key_cleanup_${i}`, 'DELETE', `/api-key/${k.id}`, { token });
}
await call('api_key_after_cleanup', 'GET', '/api/v1/get?table=smoke_people&skip=0&limit=1', {
    token: key,
    expectFail: true
});
await call('logout', 'GET', `/auth/logout?token=${token}`);
await call('after_logout', 'POST', `/web-file/data_grid_row/${file_id}?skip=0&limit=1`, {
    token,
    body: {},
    expectFail: true
});

if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exitCode = 1;
} else {
    console.log('\nAll checks passed');
}
