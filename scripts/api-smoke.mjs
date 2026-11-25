// API smoke test for horizon-be: node scripts/api-smoke.mjs [base_url] [out.json]
// Exits non-zero if any call or check fails (CI runs it: .github/workflows/ci.yml, `smoke`).
// Logs in as demo@invokedb.com, uploads a small CSV as table "smoke_people", exercises the
// grid + external /api/v1 endpoints, checks that demo2@invokedb.com can't reach demo's tables
// or account, makes tables from templates (and checks demo2's free-tier table limit), reads the
// table's generated API docs and OpenAPI spec and runs their curl, fetch and Python snippets
// (#139; Python only if python3 is installed), then deletes the tables. Writes every response to out.json
// so two runs (e.g. before/after an upgrade) can be diffed. Best run against throwaway DBs
// (HORIZON_ENV_FILE=<alt env> with different DB names) rather than your local data.
import fs from 'node:fs';
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
    if (ok === !!expectFail) console.log('     ', JSON.stringify(data).slice(0, 300));
    return data;
}

function check(name, pass, detail) {
    results[name] = pass;
    if (!pass) failures++;
    console.log(`${pass ? 'ok  ' : 'FAIL'} --- ${name}`);
    if (!pass && detail !== undefined) console.log('     ', JSON.stringify(detail).slice(0, 300));
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
check('api_docs_endpoints', doc_ids === 'get,search,create,update,delete', docs);
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
        Object.keys(spec.paths || {}).length === 5 &&
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
}

const nameCol = cols.data && cols.data.find(c => c.headerName === 'joined');
if (nameCol) {
    await call('delete_col', 'POST', `/web-file/batch_delete/data_grid_column/${file_id}`, {
        token,
        body: [nameCol._id]
    });
}
await call('support', 'POST', '/support/request', {
    token,
    body: { email: 'x@y.z', message: 'smoke' }
});
await call('file_delete', 'POST', '/file-directory/batch_delete', {
    token,
    body: { ids: [file_id] }
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
