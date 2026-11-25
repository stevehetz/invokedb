// API smoke test for horizon-be: node scripts/api-smoke.mjs [base_url] [out.json]
// Exits non-zero if any call or check fails (CI runs it: .github/workflows/ci.yml, `smoke`).
// Logs in as demo@invokedb.com, uploads a small CSV as table "smoke_people", exercises the
// grid + external /api/v1 endpoints, checks that demo2@invokedb.com can't reach demo's tables
// or account, makes tables from templates, then deletes the tables. Then signs up a free
// account and checks the plan caps (a template table counts against the table cap), a
// (locally signed) Stripe webhook upgrade and a lapse to read-only. Writes every response to out.json
// so two runs (e.g. before/after an upgrade) can be diffed. Best run against throwaway DBs
// (HORIZON_ENV_FILE=<alt env> with different DB names) rather than your local data.
import fs from 'node:fs';
import crypto from 'node:crypto';

// The made-up webhook secret smoke-env.sh gives the backend (not a real Stripe secret)
const SMOKE_WEBHOOK_SECRET = 'whsec_smoke_not_a_real_secret';
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
const demo_billing = await call('billing_status', 'GET', '/billing', { token });
check('demo_is_internal_plan', demo_billing.plan === 'internal', demo_billing);

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
await call('other_delete_template_table', 'POST', '/file-directory/batch_delete', {
    token: otoken,
    body: { ids: [tpl_id] },
    expectFail: true
});

// demo2 makes its own template table, which stays out of demo's account. (demo2 is
// 'internal', so the table cap is checked on a new free account in billing_checks.)
const other_tpl_ids = [
    await call('other_template_create', 'POST', '/table-template/waitlist', {
        token: otoken,
        body: { name: 'smoke_waitlist_0' }
    })
];
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
    'other_template_table_listed',
    Array.isArray(other_files_after) && other_files_after.some(d => d.id === other_tpl_ids[0]),
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

await billing_checks();

// Plans and caps (#129), on a new free account. smoke-env.sh makes the free caps tiny
// (1 table, 5 rows, 3 API calls a month) and sets a made-up webhook secret, so the webhook is
// "stubbed": this script signs Stripe-shaped events itself, as Stripe would.
async function billing_checks() {
    const email = `smoke-${Date.now()}@invokedb.com`;
    const password = 'Smoke-test-1A!'; // the special character must be one of !@#$%^&* (validators.ts)
    await call('signup', 'POST', '/auth/create-account', { body: { email, password } });
    const s = await call('signup_login', 'POST', '/auth/login', { body: { email, password } });
    const t = s.token;
    const acct = await call('signup_authorize', 'GET', `/auth/authorize?token=${t}`);
    const status = await call('free_billing_status', 'GET', '/billing', { token: t });
    check('signup_is_free', status.plan === 'free', status);
    check('free_needs_no_stripe_customer', status.has_billing_account === false, status);
    if (!status.limits || status.limits.max_tables > 1 || status.limits.max_rows > 5) {
        console.log('skip --- free caps not lowered (run with smoke-env.sh): billing checks');
        return;
    }
    // Stripe isn't configured in the smoke env: no API key, so Checkout and the portal are off
    await call('checkout_without_stripe', 'POST', '/billing/checkout', {
        token: t,
        expectFail: true
    });

    // Free caps: one table (a new table has 3 rows), 5 rows, 3 API calls
    const new_table = name => ({
        token: t,
        body: { account_id: acct.id, name, type: 'file', web_file_type: 'data-grid' }
    });
    const t1 = await call('free_table_1', 'POST', '/file-directory', new_table('smoke_free_1'));
    await call('free_table_2_refused', 'POST', '/file-directory', {
        ...new_table('smoke_free_2'),
        expectFail: true
    });
    // A template table counts against the table cap too, and a refused one makes nothing
    await call('free_template_over_cap', 'POST', '/table-template/waitlist', {
        token: t,
        body: { name: 'smoke_waitlist_over' },
        expectFail: true
    });
    check(
        'free_template_over_cap_forbidden',
        results.free_template_over_cap.status === 403,
        results.free_template_over_cap
    );
    const free_files = await call('free_list_after_template', 'GET', '/file-directory', {
        token: t
    });
    check(
        'free_template_over_cap_made_nothing',
        Array.isArray(free_files) && !free_files.some(d => d.name === 'smoke_waitlist_over'),
        free_files
    );
    const rows_url = `/web-file/batch_create/data_grid_row/${t1}`;
    await call('free_rows_to_cap', 'POST', rows_url, { token: t, body: [{ a: 'x' }, { a: 'y' }] });
    await call('free_rows_past_cap_refused', 'POST', rows_url, {
        token: t,
        body: [{ a: 'z' }],
        expectFail: true
    });
    const ext = `/api/v1/get?table=smoke_free_1&skip=0&limit=1`;
    for (let i = 1; i <= 3; i++)
        await call(`free_api_call_${i}`, 'GET', ext, { token: acct.api_key });
    await call('free_api_call_past_cap_refused', 'GET', ext, {
        token: acct.api_key,
        expectFail: true
    });

    // The webhook: unsigned and badly signed events are refused
    const now = Math.floor(Date.now() / 1000);
    const checkout_event = {
        id: `evt_smoke_checkout_${now}`,
        object: 'event',
        type: 'checkout.session.completed',
        created: now,
        data: {
            object: {
                id: 'cs_smoke',
                object: 'checkout.session',
                mode: 'subscription',
                payment_status: 'paid',
                client_reference_id: String(acct.id),
                customer: `cus_smoke_${acct.id}`,
                subscription: `sub_smoke_${acct.id}`,
                metadata: { account_id: String(acct.id) }
            }
        }
    };
    await webhook('webhook_unsigned', checkout_event, { sign: false, expectFail: true });
    await webhook('webhook_bad_signature', checkout_event, {
        secret: 'whsec_wrong',
        expectFail: true
    });
    const still_free = await call('billing_after_bad_webhook', 'GET', '/billing', { token: t });
    check('bad_webhook_changes_nothing', still_free.plan === 'free', still_free);

    // Upgrade: a signed checkout.session.completed raises the caps
    await webhook('webhook_checkout_completed', checkout_event);
    const pro = await call('billing_after_upgrade', 'GET', '/billing', { token: t });
    check('upgrade_sets_pro', pro.plan === 'pro' && pro.has_billing_account, pro);
    const t2 = await call('pro_table_2', 'POST', '/file-directory', new_table('smoke_free_2'));
    await call('pro_rows_past_free_cap', 'POST', rows_url, { token: t, body: [{ a: 'z' }] });
    await call('pro_api_call', 'GET', ext, { token: acct.api_key });
    const replay = await webhook('webhook_replayed', checkout_event);
    check('webhook_replay_is_duplicate', replay && replay.duplicate === true, replay);

    // Lapse: the subscription is deleted, so back to free, and over the free caps the account
    // turns read-only (reads work, writes don't) until it's back under them
    const subscription = (status, created, id) => ({
        id,
        object: 'event',
        type:
            status === 'canceled'
                ? 'customer.subscription.deleted'
                : 'customer.subscription.updated',
        created,
        data: {
            object: {
                id: `sub_smoke_${acct.id}`,
                object: 'subscription',
                status,
                customer: `cus_smoke_${acct.id}`,
                metadata: { account_id: String(acct.id) }
            }
        }
    });
    await webhook(
        'webhook_subscription_deleted',
        subscription('canceled', now + 10, `evt_smoke_del_${now}`)
    );
    // An older event arriving late must not undo the cancel
    await webhook('webhook_out_of_order', subscription('active', now + 5, `evt_smoke_old_${now}`));
    const lapsed = await call('billing_after_lapse', 'GET', '/billing', { token: t });
    check('lapse_sets_free_read_only', lapsed.plan === 'free' && lapsed.read_only, lapsed);
    await call('read_only_read_works', 'POST', `/web-file/data_grid_row/${t1}?skip=0&limit=10`, {
        token: t,
        body: {}
    });
    await call('read_only_write_refused', 'POST', `/web-file/batch_create/data_grid_row/${t2}`, {
        token: t,
        body: [{ a: 'w' }],
        expectFail: true
    });
    await call('lapsed_api_calls_refused', 'GET', ext, { token: acct.api_key, expectFail: true });
    // Deleting gets it back under the caps (and the delete itself is allowed)
    await call('read_only_delete_works', 'POST', '/file-directory/batch_delete', {
        token: t,
        body: { ids: [t2] }
    });
    const back = await call('billing_after_delete', 'GET', '/billing', { token: t });
    check('under_caps_is_writable_again', back.read_only === false, back);
    await call('free_cleanup', 'POST', '/file-directory/batch_delete', {
        token: t,
        body: { ids: [t1] }
    });
    await call('signup_logout', 'GET', `/auth/logout?token=${t}`);
}

// Posts a Stripe-shaped event to /webhook/stripe, signed the way Stripe signs (HMAC-SHA256 of
// "<timestamp>.<body>" with the endpoint secret)
async function webhook(name, event, { sign = true, secret, expectFail } = {}) {
    const key = secret || process.env.STRIPE_WEBHOOK_SECRET || SMOKE_WEBHOOK_SECRET;
    const body = JSON.stringify(event);
    const headers = { 'Content-Type': 'application/json' };
    if (sign) {
        const ts = Math.floor(Date.now() / 1000);
        const v1 = crypto.createHmac('sha256', key).update(`${ts}.${body}`).digest('hex');
        headers['Stripe-Signature'] = `t=${ts},v1=${v1}`;
    }
    const res = await fetch(BASE + '/webhook/stripe', { method: 'POST', headers, body });
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

if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exitCode = 1;
} else {
    console.log('\nAll checks passed');
}
