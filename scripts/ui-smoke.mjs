// UI smoke test for horizon-fe:
//   node scripts/ui-smoke.mjs [--out out.json] [--headed] [--keep] [--bundled] [--artifacts dir] [--trace]
//
// Drives the installed Chrome (Playwright, no browser download) through the main user flows:
// render the public site's pages, log in, upload a CSV, sort / filter / edit cells in the grid, add and remove
// columns, change a column type (a background job whose progress arrives over the websocket),
// open the table's API docs and "Try it" on Get, read the API key from the account page and call /api/v1 with it, make (and delete) a table
// from a template, then delete the table through the UI and log out. Stops at the first failing step and saves a screenshot.
//
// URLs come from the same env vars the apps use, so load an env file first. Best run against
// the throwaway stack described in .agents/skills/verify-frontend/SKILL.md, not your own data:
//   HORIZON_ENV_FILE=<smoke.env> bash -c 'source scripts/env.sh && node scripts/ui-smoke.mjs'
//
// Production (e2e.yml, #90): the HORIZON_*_PUB_* URLs point at invokedb.com, SMOKE_EMAIL and
// SMOKE_PASSWORD name the test account (default demo@invokedb.com / password), --bundled uses
// Playwright's own Chromium instead of the installed Chrome, and --artifacts keeps the failure
// screenshot in that folder (password and API key fields masked). --trace also saves a Playwright
// trace there on failure; it holds the password, session token and API key, so only use it
// locally, never in a workflow (the repo's artifacts are public). Every run starts by deleting any table left
// from an earlier run and, on failure, deletes the one it made.
//
// --out writes the observations (grid contents, headers, websocket events) as JSON, with no
// IDs or tokens, so a run before and after a frontend change can be diffed directly.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const env = process.env;
// One frontend: the public site at /, the signed-in app under /app
const FE_URL = env.HORIZON_FE_PUB_HTTP_URL || 'http://127.0.0.1:8000';
const APP_URL = `${FE_URL}/app`;
const BE_URL = env.HORIZON_BE_PUB_HTTP_URL || 'http://127.0.0.1:8001';
const API_URL = env.HORIZON_API_PUB_HTTP_URL || `${BE_URL}/api`;
const WS_URL = env.HORIZON_SB_PUB_WS_URL || 'ws://127.0.0.1:9000';
const EMAIL = env.SMOKE_EMAIL || 'demo@invokedb.com';
const PASSWORD = env.SMOKE_PASSWORD || 'password';
const TABLE = 'ui_smoke_people';
const TEMPLATE_TABLE = 'ui_smoke_tasks';
const OUT = opt('--out');
const ARTIFACTS = opt('--artifacts');
if (ARTIFACTS) fs.mkdirSync(ARTIFACTS, { recursive: true });
const SHOT_DIR = ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'ui-smoke-'));

const CSV = 'name,age,joined\nalice,30,2020-01-02\nbob,41,2021-05-06\ncarol,25,2019-12-31\n';

const results = { steps: {}, observed: {}, ws_events: [], page_errors: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function check(cond, msg) {
    if (!cond) throw new Error(msg);
}

// ---------- backend helpers (setup, cleanup, and checking what the UI saved) ----------

async function be(method, url_path, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BE_URL + url_path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }
    if (!res.ok) throw new Error(`${method} ${url_path} -> ${res.status} ${text.slice(0, 200)}`);
    return data;
}

async function be_session() {
    const session = await be('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    const me = await be('GET', `/auth/authorize?token=${session.token}`);
    return { token: session.token, account_id: me.id };
}

async function find_tables(s, name = TABLE) {
    const dirs = await be('GET', `/file-directory?account_id=${s.account_id}`, { token: s.token });
    return dirs.filter(d => d.name === name);
}

async function delete_leftover_tables() {
    const s = await be_session();
    const ids = [...(await find_tables(s)), ...(await find_tables(s, TEMPLATE_TABLE))].map(
        d => d.id
    );
    if (ids.length) {
        console.log(`     removing ${ids.length} leftover "${TABLE}"/"${TEMPLATE_TABLE}" table(s)`);
        await be('POST', '/file-directory/batch_delete', { token: s.token, body: { ids } });
    }
    await be('GET', `/auth/logout?token=${s.token}`);
}

// Rows as the backend stores them, keyed by header name instead of field id
async function be_table(s, file_id) {
    const cols = await be('POST', `/web-file/data_grid_column/${file_id}?skip=0&limit=50`, {
        token: s.token,
        body: {}
    });
    const rows = await be('POST', `/web-file/data_grid_row/${file_id}?skip=0&limit=50`, {
        token: s.token,
        body: {}
    });
    const named = cols.data.filter(c => c.field !== 'row_num');
    return {
        columns: named.map(c => ({ name: c.headerName, type: c.col_type, indexed: !!c.indexed })),
        rows: rows.data.map(r => Object.fromEntries(named.map(c => [c.headerName, r[c.field]])))
    };
}

// ---------- browser helpers ----------

let page;

async function step(name, fn) {
    const t0 = Date.now();
    try {
        await fn();
        results.steps[name] = 'ok';
        console.log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (ex) {
        results.steps[name] = `FAIL: ${ex.message.split('\n')[0]}`;
        const shot = path.join(SHOT_DIR, `${name}.png`);
        // Masked: in CI the screenshot is a public artifact
        const mask = page ? [page.locator('input[type=password], .api-key-form input')] : [];
        if (page) await page.screenshot({ path: shot, mask }).catch(() => {});
        console.log(`FAIL ${name}\n      ${ex.message.split('\n').slice(0, 6).join('\n      ')}`);
        console.log(`      screenshot: ${shot}`);
        throw ex;
    }
}

const grid = () => page.locator('.el-tab-pane:visible .h-data-grid');

// Header labels in display order (excluding the row number column)
async function headers() {
    const labels = await grid()
        .locator('.ag-header-row .ag-header-cell .grid-header.read .grid-header-label')
        .allInnerTexts();
    return labels.map(l => l.trim()).filter(l => l !== 'Row');
}

async function col_id(header_name) {
    const cells = grid().locator('.ag-header-row .ag-header-cell');
    const n = await cells.count();
    for (let i = 0; i < n; i++) {
        const label = await cells
            .nth(i)
            .locator('.grid-header-label')
            .innerText()
            .catch(() => '');
        if (label.trim() === header_name) return cells.nth(i).getAttribute('col-id');
    }
    throw new Error(`no column header "${header_name}" (have: ${(await headers()).join(', ')})`);
}

// Visible grid rows as objects keyed by header name, in display order
async function grid_rows() {
    const names = await headers();
    const ids = [];
    for (const n of names) ids.push(await col_id(n));
    // Body rows by row-index, wherever ag-grid puts them (since v33 they aren't all inside
    // .ag-center-cols-container); a row split across containers is merged
    return grid()
        .locator('.ag-row[row-index]')
        .evaluateAll(
            (rows, { names, ids }) => {
                const by_index = new Map();
                for (const r of rows) {
                    const i = Number(r.getAttribute('row-index'));
                    const row = by_index.get(i) || {};
                    names.forEach((n, k) => {
                        const cell = r.querySelector(`.ag-cell[col-id="${ids[k]}"]`);
                        if (cell) row[n] = cell.innerText.trim();
                        else if (!(n in row)) row[n] = null;
                    });
                    by_index.set(i, row);
                }
                return [...by_index.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
            },
            { names, ids }
        );
}

async function wait_rows(pred, what, timeout = 15000) {
    const end = Date.now() + timeout;
    let rows;
    while (Date.now() < end) {
        rows = await grid_rows().catch(() => null);
        if (rows && rows.length && pred(rows)) return rows;
        await sleep(250);
    }
    throw new Error(`timed out waiting for ${what}; grid shows ${JSON.stringify(rows)}`);
}

async function wait_idle() {
    // The grid shows an overlay while saving columns or while a background job runs
    await grid().locator('.grid-processing-overlay').waitFor({ state: 'hidden', timeout: 30000 });
    await grid().locator('.column-overlay').waitFor({ state: 'hidden', timeout: 30000 });
}

// In edit-columns mode the header labels become inputs; find a header cell by its input's value
async function edit_header(name) {
    const cells = grid().locator('.ag-header-row .ag-header-cell');
    const values = await cells.evaluateAll(els =>
        els.map(e => {
            const input = e.querySelector('.grid-header-input input');
            return input ? input.value : null;
        })
    );
    const i = values.indexOf(name);
    check(i >= 0, `no editable "${name}" header (have: ${values.filter(v => v !== null)})`);
    return cells.nth(i);
}

// Selectors from each area's global stylesheet that are on the page. The site and the app must
// never have each other's CSS loaded (see router.js in horizon-fe).
async function loaded_css(markers) {
    return page.evaluate(markers => {
        const text = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) text.push(rule.selectorText || '');
            } catch {} // cross-origin CDN sheets
        }
        const all = text.join(' ');
        return markers.filter(m => all.includes(m));
    }, markers);
}
const SITE_CSS = '.panel-box'; // only in the site stylesheet
const APP_CSS = '.h-data-grid'; // only in the app stylesheet

function ws_events_since(i) {
    return results.ws_events.slice(i).map(e => e.event);
}

// ---------- the run ----------

await delete_leftover_tables();

const browser = await chromium.launch({
    channel: flag('--bundled') ? undefined : 'chrome',
    headless: !flag('--headed')
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const TRACE = ARTIFACTS && flag('--trace');
if (TRACE) await context.tracing.start({ screenshots: true, snapshots: true });
page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('pageerror', e => results.page_errors.push(e.message.split('\n')[0]));
page.on('websocket', ws => {
    if (!ws.url().startsWith(WS_URL)) return; // skip webpack-dev-server's sockjs socket
    ws.on('framereceived', f => {
        try {
            const { action, payload } = JSON.parse(String(f.payload));
            if (action === 'directMessage' && payload && payload.event) {
                results.ws_events.push({ event: payload.event, at: Date.now() });
            }
        } catch {}
    });
});

const csv_path = path.join(SHOT_DIR, 'people.csv');
fs.writeFileSync(csv_path, CSV);

let file_id;
let be_s;
let failed = false;

try {
    await step('public_pages', async () => {
        const pages = {
            '/': '.home-page',
            '/pricing': '.pricing-page',
            '/contact': '.contact-page',
            '/create-account': '.create-account-page',
            '/forgot-password': '.forgot-password-page',
            '/tos': '.tos-page',
            '/privacy': '.privacy-page',
            '/login': '.login-page'
        };
        results.observed.public_pages = {};
        for (const [p, root] of Object.entries(pages)) {
            await page.goto(FE_URL + p);
            await page.locator(root).first().waitFor();
            results.observed.public_pages[p] = await loaded_css([SITE_CSS, APP_CSS]);
            check(
                results.observed.public_pages[p].join() === SITE_CSS,
                `${p} has CSS ${results.observed.public_pages[p]} (want only the site's)`
            );
        }
        // Signed out, the app sends you to the login page
        await page.goto(APP_URL);
        await page.waitForURL(u => u.pathname === '/login', { timeout: 15000 });
    });

    await step('login', async () => {
        await page.goto(`${FE_URL}/login`);
        await page.getByPlaceholder('Email').fill(EMAIL);
        await page.getByPlaceholder('Password').fill(PASSWORD);
        await page.locator('.login-button').click();
        await page.waitForURL(u => u.href.startsWith(APP_URL), { timeout: 30000 });
        await page.locator('.layout .header-text', { hasText: EMAIL }).waitFor();
        results.observed.token_in_url = page.url().includes('token');
        check(!results.observed.token_in_url, `session token is in the URL: ${page.url()}`);
        results.observed.app_css = await loaded_css([SITE_CSS, APP_CSS]);
        check(
            results.observed.app_css.join() === APP_CSS,
            `the app has CSS ${results.observed.app_css} (want only the app's)`
        );
    });

    await step('upload_csv', async () => {
        const ws_start = results.ws_events.length;
        await page.locator('.h-tree-controls .title-icon').click();
        await page.locator('.h-tree-menu-popper').getByText('Table from CSV').click();
        const dlg = page.locator('.upload-dialog .el-dialog');
        await dlg.locator('input[type=file]').setInputFiles(csv_path);
        await dlg.locator('.new-name input').fill(TABLE);
        await dlg.getByRole('button', { name: 'Upload' }).click();
        await page.locator('.el-tabs__item', { hasText: TABLE }).waitFor();
        await wait_rows(r => r.length === 3, 'three uploaded rows', 30000);
        results.observed.upload_headers = await headers();
        results.observed.upload_rows = await grid_rows();
        results.observed.upload_ws_events = ws_events_since(ws_start);
        check(
            results.observed.upload_ws_events.includes('WEB_FILE_PROCESS_COMPLETE'),
            `no WEB_FILE_PROCESS_COMPLETE over the websocket (got ${results.observed.upload_ws_events})`
        );
        be_s = await be_session();
        const tables = await find_tables(be_s);
        check(tables.length === 1, `expected 1 "${TABLE}" table, found ${tables.length}`);
        file_id = tables[0].id;
    });

    await step('sort', async () => {
        const age = grid().locator(
            `.ag-header-cell[col-id="${await col_id('age')}"] .grid-header.read`
        );
        await age.click();
        const asc = await wait_rows(r => r[0].name === 'carol', 'ascending age sort');
        await age.click();
        const desc = await wait_rows(r => r[0].name === 'bob', 'descending age sort');
        results.observed.sort_asc = asc.map(r => r.name);
        results.observed.sort_desc = desc.map(r => r.name);
        await age.click(); // third click clears the sort
        await wait_rows(r => r[0].name === 'alice', 'sort cleared');
    });

    await step('filter', async () => {
        // Since ag-grid 33 the floating filter cell has the column's col-id (and .ag-header-cell)
        const input = grid().locator(
            `.ag-floating-filter[col-id="${await col_id('name')}"] .custom-filter-text`
        );
        await input.pressSequentially('o'); // the filter listens for keyup, not input
        const filtered = await wait_rows(r => r.length === 2, 'name contains "o" filter');
        results.observed.filter_contains_o = filtered.map(r => r.name);
        await input.press('Backspace');
        await wait_rows(r => r.length === 3, 'filter cleared');
    });

    await step('cell_edit', async () => {
        const id = await col_id('name');
        const cell = grid().locator(`.ag-row[row-index="0"] .ag-cell[col-id="${id}"]`);
        await cell.dblclick();
        const editor = grid()
            .locator('.ag-cell-inline-editing input, .ag-popup-editor input')
            .first();
        await editor.fill('alice2');
        await editor.press('Enter');
        await wait_rows(r => r[0].name === 'alice2', 'edited cell in grid');
        const end = Date.now() + 10000;
        let saved;
        while (Date.now() < end) {
            saved = await be_table(be_s, file_id);
            if (saved.rows.some(r => r.name === 'alice2')) break;
            await sleep(300);
        }
        check(
            saved.rows.some(r => r.name === 'alice2'),
            'cell edit was not saved to the backend'
        );
        results.observed.cell_edit_saved = true;
    });

    await step('add_column', async () => {
        await grid().getByRole('button', { name: 'Edit Columns' }).click();
        const inputs = grid().locator('.ag-header-row .grid-header.edit .grid-header-input input');
        await inputs.first().waitFor();
        const before = await inputs.count();
        await grid().getByRole('button', { name: 'Add Column' }).click();
        await inputs.nth(before).waitFor(); // the new column is fetched from the backend first
        const input = inputs.nth(before);
        check((await input.inputValue()) === '', 'the new column header is not empty');
        await input.fill('');
        await input.pressSequentially('city'); // the header listens for keyup, not input
        await grid().locator('.commit-controls .blue').click();
        await wait_idle();
        await page.waitForFunction(() => !document.querySelector('.h-data-grid.edit-column-mode'));
        const end = Date.now() + 10000;
        while (Date.now() < end && !(await headers()).includes('city')) await sleep(250);
        results.observed.add_column_headers = await headers();
        check(results.observed.add_column_headers.includes('city'), 'new column "city" not shown');
        const saved = await be_table(be_s, file_id);
        check(
            saved.columns.some(c => c.name === 'city'),
            'new column "city" not saved'
        );
    });

    await step('remove_column', async () => {
        await grid().getByRole('button', { name: 'Edit Columns' }).click();
        await (await edit_header('joined')).locator('.grid-header__delete').click();
        await grid().locator('.commit-controls .blue').click();
        const confirm = page.locator('.confirm-dialog .el-dialog');
        if (await confirm.isVisible().catch(() => false)) {
            await confirm.getByRole('button', { name: 'Confirm' }).click();
        }
        await wait_idle();
        const end = Date.now() + 15000;
        while (Date.now() < end && (await headers()).includes('joined')) await sleep(250);
        results.observed.remove_column_headers = await headers();
        check(!results.observed.remove_column_headers.includes('joined'), '"joined" still shown');
        const saved = await be_table(be_s, file_id);
        check(!saved.columns.some(c => c.name === 'joined'), '"joined" still saved');
    });

    await step('websocket_type_change', async () => {
        // Changing a column type (with an index) runs as a background job. The grid locks,
        // and it only reloads when WEB_FILE_PROCESS_COMPLETE arrives over the websocket.
        const ws_start = results.ws_events.length;
        await grid().getByRole('button', { name: 'Edit Columns' }).click();
        const age_header = await edit_header('age');
        await age_header.locator('.active-column-type').click();
        await page.locator('.grid-header-type__menu:visible .menu__item.number').click();
        await age_header.locator('.grid-header-index').click();
        await grid().locator('.commit-controls .blue').click();
        const end = Date.now() + 30000;
        while (Date.now() < end && !ws_events_since(ws_start).includes('WEB_FILE_PROCESS_COMPLETE'))
            await sleep(250);
        results.observed.type_change_ws_events = ws_events_since(ws_start);
        check(
            results.observed.type_change_ws_events.includes('WEB_FILE_PROCESS_COMPLETE'),
            `no WEB_FILE_PROCESS_COMPLETE (got ${results.observed.type_change_ws_events})`
        );
        await wait_idle();
        const saved = await be_table(be_s, file_id);
        const age = saved.columns.find(c => c.name === 'age');
        check(age && age.type === 'number' && age.indexed, `age column is ${JSON.stringify(age)}`);
        results.observed.type_change_rows = await grid_rows();
        results.observed.type_change_header_type = (
            await grid()
                .locator(`.ag-header-cell[col-id="${await col_id('age')}"] .grid-header-type`)
                .getAttribute('class')
        )
            .split(' ')
            .filter(c => c !== 'grid-header-type');
    });

    // The table's own API docs (#139): its endpoints, snippets with its name, and "Try it" on
    // Get, which sends a real (read-only) request with the account's key
    await step('table_api_docs', async () => {
        await grid().locator('.api-button button').click();
        const dialog = page.locator('.container-dialog .api-dialog');
        const tabs = dialog.locator('.api-dialog-tab');
        await tabs.first().waitFor();
        results.observed.api_docs_tabs = await tabs.allInnerTexts();
        check(results.observed.api_docs_tabs.length === 7, 'the API dialog has no 7 endpoint tabs');
        const snippet = await dialog.locator('.api-dialog-snippet pre').innerText();
        check(snippet.includes(`table=${TABLE}`), `the curl snippet doesn't name ${TABLE}`);
        await dialog.getByRole('button', { name: 'Send request' }).click();
        const status = dialog.locator('.try-response .try-status');
        await status.waitFor();
        results.observed.api_docs_try_status = (await status.innerText()).trim();
        check(
            results.observed.api_docs_try_status === '200',
            `Try it on Get answered ${results.observed.api_docs_try_status}`
        );
        const body = JSON.parse(await dialog.locator('.try-response pre').innerText());
        check(body.count === 3, `Try it on Get returned count ${body.count}`);
        // Query rows (#141) is read-only too, and answers rows and a cursor
        await tabs.filter({ hasText: 'Query rows' }).click();
        await dialog.getByRole('button', { name: 'Send request' }).click();
        await status.waitFor();
        results.observed.api_docs_query_status = (await status.innerText()).trim();
        check(
            results.observed.api_docs_query_status === '200',
            `Try it on Query answered ${results.observed.api_docs_query_status}`
        );
        const query_body = JSON.parse(await dialog.locator('.try-response pre').innerText());
        check(
            Array.isArray(query_body.data) && 'next_cursor' in query_body,
            'Try it on Query returned no data and next_cursor'
        );
        // Writes are off by default
        await tabs.filter({ hasText: 'Delete rows' }).click();
        check(
            await dialog.getByRole('button', { name: 'Send request' }).isDisabled(),
            'Try it on Delete is enabled without "Allow requests that change data"'
        );
        await page.locator('.container-dialog .el-dialog__headerbtn').click();
        await dialog.waitFor({ state: 'detached' });
    });

    await step('api_key_and_external_api', async () => {
        await page.locator('.layout .nav .el-menu-item', { hasText: 'Account' }).click();
        const key_input = page.locator('.api-key-form input');
        await key_input.waitFor();
        const end = Date.now() + 10000;
        let key = '';
        while (Date.now() < end && !(key = await key_input.inputValue())) await sleep(250);
        check(key, 'API key field is empty');
        const res = await fetch(`${API_URL}/v1/get?table=${TABLE}&skip=0&limit=10`, {
            headers: { Authorization: `Bearer ${key}` }
        });
        check(res.ok, `/api/v1/get with the page's key -> ${res.status}`);
        const data = await res.json();
        const rows = Array.isArray(data) ? data : data.data;
        results.observed.external_api_rows = rows.map(r => {
            const { _id, ...rest } = r;
            return rest;
        });
        check(rows.length === 3, `/api/v1/get returned ${rows.length} rows`);
        await page.locator('.layout .nav .el-menu-item', { hasText: 'Tables' }).click();
    });

    await step('table_from_template', async () => {
        await page.locator('.h-tree-controls .title-icon').click();
        await page.locator('.h-tree-menu-popper').getByText('Table from Template').click();
        const dlg = page.locator('.template-dialog .el-dialog');
        await dlg.locator('.template-item[data-template-id="tasks"]').click();
        await dlg.locator('.new-name input').fill(TEMPLATE_TABLE);
        await dlg.getByRole('button', { name: 'Create' }).click();
        await page.locator('.el-tabs__item', { hasText: TEMPLATE_TABLE }).waitFor();
        await wait_rows(r => r.length === 4, 'four sample rows');
        results.observed.template_headers = await headers();
        const tables = await find_tables(be_s, TEMPLATE_TABLE);
        check(tables.length === 1, `expected 1 "${TEMPLATE_TABLE}" table, found ${tables.length}`);
        const saved = await be_table(be_s, tables[0].id);
        results.observed.template_columns = saved.columns;
        check(
            saved.columns.map(c => `${c.name}:${c.type}`).join() ===
                'Task:string,Owner:string,Priority:string,Status:string,Estimate Hours:number,Due:date',
            `template columns are ${JSON.stringify(saved.columns)}`
        );
        check(
            results.observed.template_headers.join() === saved.columns.map(c => c.name).join(),
            `grid headers are ${results.observed.template_headers}`
        );
        // Delete it through the UI, like the uploaded table below
        await page
            .locator('.h-tree .tree-wrapper')
            .getByText(TEMPLATE_TABLE, { exact: true })
            .click();
        await page.locator('.h-tree .manage-items.active .remove-items').click();
        await page
            .locator('.confirm-dialog .el-dialog')
            .getByRole('button', { name: 'Confirm' })
            .click();
        await page
            .locator('.el-tabs__item', { hasText: TEMPLATE_TABLE })
            .waitFor({ state: 'detached' });
        check(
            (await find_tables(be_s, TEMPLATE_TABLE)).length === 0,
            'template table still exists in the backend'
        );
    });

    await step('delete_table', async () => {
        await page.locator('.h-tree .tree-wrapper').getByText(TABLE, { exact: true }).click();
        await page.locator('.h-tree .manage-items.active .remove-items').click();
        const confirm = page.locator('.confirm-dialog .el-dialog');
        await confirm.getByRole('button', { name: 'Confirm' }).click();
        await page.locator('.el-tabs__item', { hasText: TABLE }).waitFor({ state: 'detached' });
        check((await find_tables(be_s)).length === 0, 'table still exists in the backend');
    });

    await step('logout', async () => {
        await page.locator('.layout .header-link .fa-sign-out-alt').click();
        await page.waitForURL(u => u.href.startsWith(FE_URL) && !u.pathname.startsWith('/app'), {
            timeout: 15000
        });
        await page.locator('.home-page').waitFor();
    });
} catch {
    failed = true;
} finally {
    if (TRACE) {
        const trace = failed ? path.join(ARTIFACTS, 'trace.zip') : undefined;
        await context.tracing.stop(trace ? { path: trace } : undefined).catch(() => {});
        if (trace) console.log(`      trace: ${trace}`);
    }
    await browser.close();
    if (be_s) await be('GET', `/auth/logout?token=${be_s.token}`).catch(() => {});
    if (failed && !flag('--keep')) await delete_leftover_tables().catch(() => {});
}

results.observed.page_errors = results.page_errors;
delete results.page_errors;
results.ws_events = results.ws_events.map(e => e.event);
if (results.observed.page_errors.length) {
    console.log(`warn ${results.observed.page_errors.length} uncaught page error(s):`);
    for (const e of [...new Set(results.observed.page_errors)]) console.log(`      ${e}`);
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
if (!failed && !ARTIFACTS) fs.rmSync(SHOT_DIR, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
