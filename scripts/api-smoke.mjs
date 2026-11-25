// API smoke test for horizon-be: node scripts/api-smoke.mjs [base_url] [out.json]
// Exits non-zero if any call or check fails (CI runs it: .github/workflows/ci.yml, `smoke`).
// Logs in as demo@invokedb.com, uploads a small CSV as table "smoke_people", exercises the
// grid + external /api/v1 endpoints, checks that demo2@invokedb.com can't reach demo's tables
// or account, checks each account's onboarding checklist (#143: runs its curl command, ticks,
// dismisses demo2's), makes tables from templates (and checks demo2's free-tier table limit), reads the
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
// deleted, a kanban board and a moved card, bar/pie/line charts, demo2 and API keys locked
// out, a deleted table's views gone), checks link columns (#147: picker, grid labels, ids and
// `expand` on /api/v1, bad links refused, deleted rows cleared from links, no links across
// accounts; a deleted linked table empties the cells and makes the column a string, #175),
// checks "ask your data" (#149: a stub of the Anthropic API on 127.0.0.1:8197, set by
// smoke-env.sh; answer, rows and the API call, bad model queries refused, the monthly cap, demo2
// and API keys locked out; then AI rows and tables, #148: typed preview rows, the monthly row
// allowance, demo2 locked out), checks API keys (#138: made for each account and revoked at the end;
// read-only and table-scoped keys refused, revoked keys refused, only hashes listed, demo's
// migrated key still works, demo2 locked out) and email verification on signup (#132: the same
// answer for a taken email, an unverified account with no API key and no tables, resend, bad
// links), then deletes the tables and the new account. Writes every response to out.json
// so two runs (e.g. before/after an upgrade) can be diffed. Best run against throwaway DBs
// (HORIZON_ENV_FILE=<alt env> with different DB names) rather than your local data.
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

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
await call('authorize_no_token', 'GET', '/auth/authorize');
await call('confirm_reset_no_token', 'GET', '/auth/confirm-reset-token', { expectFail: true });
await call('unauth_web_file', 'POST', '/web-file/data_grid_row/1?skip=0&limit=1', {
    expectFail: true
});
await call('plan_tiers', 'GET', '/subscription/plan-tiers', { token });

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

// demo2 is on the free tier: a template table counts against its table limit (3 tables)
const other_files = await call('other_list_before_templates', 'GET', '/file-directory', {
    token: otoken
});
const free_max_tables = 3;
const other_tpl_ids = [];
const other_file_count = Array.isArray(other_files)
    ? other_files.filter(d => d.type === 'file').length
    : 0;
for (let i = other_file_count; i < free_max_tables; i++) {
    other_tpl_ids.push(
        await call(`other_template_create_${i}`, 'POST', '/table-template/waitlist', {
            token: otoken,
            body: { name: `smoke_waitlist_${i}` }
        })
    );
}
await call('other_template_over_limit', 'POST', '/table-template/waitlist', {
    token: otoken,
    body: { name: 'smoke_waitlist_over' },
    expectFail: true
});
check(
    'other_template_over_limit_forbidden',
    results.other_template_over_limit.status === 403,
    results.other_template_over_limit
);
const own_list_tpl = await call('own_list_after_templates', 'GET', '/file-directory', { token });
check(
    'other_templates_not_in_own_account',
    Array.isArray(own_list_tpl) && !own_list_tpl.some(d => other_tpl_ids.includes(d.id)),
    own_list_tpl
);
const other_files_after = await call('other_list_after_templates', 'GET', '/file-directory', {
    token: otoken
});
check(
    'other_template_over_limit_made_nothing',
    Array.isArray(other_files_after) &&
        !other_files_after.some(d => d.name === 'smoke_waitlist_over'),
    other_files_after
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
    view_create_bad_type: { ...grid_view_body, type: 'calendar' },
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
await call('api_key_revoked_get', 'GET', TASKS, { token: ro?.secret, expectFail: true });
status_is('api_key_revoked_get', 401);
await call('api_key_revoked_other_table', 'GET', CONTACTS, { token: ro?.secret, expectFail: true });
await call('api_key_revoked_query', 'POST', '/api/v1/query?table=smoke_link_tasks', {
    token: ro?.secret,
    body: {},
    expectFail: true
});
await call('api_key_revoke_again', 'DELETE', `/api-key/${ro?.key?.id}`, { token });
await call('api_key_revoke_unknown', 'DELETE', '/api-key/999999999', { token, expectFail: true });
await call('api_key_revoke_bad_id', 'DELETE', '/api-key/abc', { token, expectFail: true });
await call('api_key_other_keys_unaffected', 'GET', TASKS, { token: scoped?.secret });
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
// What the stub says each call used (a big number tests the cost cap)
let ai_next_usage = { input_tokens: 50, output_tokens: 5 };
// The stub's answer to a structured-output request (#148): a table design, or the rows the
// prompt asks for ("Generate exactly N new rows."), text values "<column> <n>"
function ai_stub_json(body) {
    const props = body.output_config.format.schema.properties || {};
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
        let content;
        if (structured) {
            content = [{ type: 'text', text: JSON.stringify(ai_stub_json(body)) }];
        } else if (!result) {
            content = [
                {
                    type: 'tool_use',
                    id: `toolu_smoke_${ai_requests.length}`,
                    name: 'run_query',
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
                stop_reason: structured || result ? 'end_turn' : 'tool_use',
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
        ai_turns[0].body.tools?.[0]?.input_schema?.properties?.fields?.items?.enum?.includes('age'),
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
        gen_preview?.usage?.used === gen_used_before + 13,
    gen_preview
);
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
if (unv_dir) {
    await call('unverified_folder_delete', 'POST', '/file-directory/batch_delete', {
        token: unv_token,
        body: { ids: [unv_dir] }
    });
}
if (unv_me?.id) {
    await call('unverified_delete_account', 'PUT', `/account/delete_account/${unv_me.id}`, {
        token: unv_token
    });
}
await call('unverified_logout', 'GET', `/auth/logout?token=${unv_token}`);

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
