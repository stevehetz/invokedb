// UI smoke test for horizon-fe:
//   node scripts/ui-smoke.mjs [--out out.json] [--headed] [--keep] [--bundled] [--artifacts dir] [--trace]
//
// Drives the installed Chrome (Playwright, no browser download) through the main user flows:
// render the public site's pages, log in, check the onboarding checklist, upload a CSV, sort / filter / edit cells in the grid, add and remove
// columns, change a column type (a background job whose progress arrives over the websocket),
// open the table's API docs and "Try it" on Get, add / test / disable / delete a webhook, ask the
// table a question (#149, against a stub of the Anthropic API on the smoke stack), make a read-only table-scoped API key on the account page, call /api/v1 with it and revoke it (#138), make a form and submit it
// through its public link, then close and delete it, make (and delete) a table
// from a template (saving a grid view of it, a kanban view where a card is dragged and a
// chart view, #146) and one from a URL (a CSV on GitHub, so it needs internet), add a link column
// to a tasks table, fill a cell from its picker and open the linked table (#147), check the
// schema diagram draws both tables and the link and opens a table (#208), generate rows
// and make a table from a description (#148; only against the Anthropic stub, so skipped against
// production), then delete the table through the UI and log out. Stops at the first failing step and saves a screenshot.
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
import http from 'node:http';
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
const URL_TABLE = 'ui_smoke_todo';
// The table a link column (#147) points to, made from the tasks template
const LINK_TABLE = 'ui_smoke_link_tasks';
const LINKED_TASK = 'Write the launch post';
// A table from a description (#148)
const AI_TABLE = 'ui_smoke_ai_table';
// A public CSV for "Table from URL" (#144): this repo's own example data on GitHub
const URL_SOURCE =
    'https://raw.githubusercontent.com/stevehetz/invokedb/main/examples/data/todo.csv';
const OUT = opt('--out');
const ARTIFACTS = opt('--artifacts');
if (ARTIFACTS) fs.mkdirSync(ARTIFACTS, { recursive: true });
const SHOT_DIR = ARTIFACTS || fs.mkdtempSync(path.join(os.tmpdir(), 'ui-smoke-'));

const CSV = 'name,age,joined\nalice,30,2020-01-02\nbob,41,2021-05-06\ncarol,25,2019-12-31\n';

// Ask your data (#149): on the smoke stack, a stub of the Anthropic Messages API where
// smoke-env.sh's ANTHROPIC_BASE_URL points. Its first reply reads every row (run_query with no
// filters), the next says how many there are.
const AI_STUB_URL = 'http://127.0.0.1:8197';
let ai_stub = null;

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
if (env.ANTHROPIC_BASE_URL === AI_STUB_URL) {
    ai_stub = http.createServer((req, res) => {
        let raw = '';
        req.on('data', c => (raw += c));
        req.on('end', () => {
            let body = {};
            try {
                body = JSON.parse(raw);
            } catch {}
            const last = (body.messages || []).at(-1);
            const result = Array.isArray(last?.content)
                ? last.content.find(c => c.type === 'tool_result')
                : null;
            const structured = !!body.output_config?.format;
            const content = structured
                ? [{ type: 'text', text: JSON.stringify(ai_stub_json(body)) }]
                : result
                  ? [
                        {
                            type: 'text',
                            text: `Stub: ${JSON.parse(result.content).total_matching} rows match`
                        }
                    ]
                  : // "add ..." asks for rows (#234): propose 2 of them
                    /^add /i.test(String(body.messages?.[0]?.content || ''))
                    ? [
                          {
                              type: 'tool_use',
                              id: 'toolu_ui_smoke',
                              name: 'propose_rows',
                              input: { count: 2, description: 'two more people' }
                          }
                      ]
                    : [{ type: 'tool_use', id: 'toolu_ui_smoke', name: 'run_query', input: {} }];
            res.setHeader('Content-Type', 'application/json');
            res.end(
                JSON.stringify({
                    id: 'msg_ui_smoke',
                    type: 'message',
                    role: 'assistant',
                    model: body.model,
                    content,
                    stop_reason: structured || result ? 'end_turn' : 'tool_use',
                    stop_sequence: null,
                    usage: { input_tokens: 50, output_tokens: 5 }
                })
            );
        });
    });
    await new Promise((resolve, reject) => {
        ai_stub.once('error', reject);
        ai_stub.listen(8197, '127.0.0.1', resolve);
    });
}

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
    const ids = [
        ...(await find_tables(s)),
        ...(await find_tables(s, TEMPLATE_TABLE)),
        ...(await find_tables(s, URL_TABLE)),
        ...(await find_tables(s, LINK_TABLE)),
        ...(await find_tables(s, AI_TABLE))
    ].map(d => d.id);
    if (ids.length) {
        console.log(
            `     removing ${ids.length} leftover "${TABLE}"/"${TEMPLATE_TABLE}"/"${URL_TABLE}"/"${LINK_TABLE}"/"${AI_TABLE}" table(s)`
        );
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
        const mask = page
            ? [
                  page.locator(
                      'input[type=password], .api-key-secret, .onboarding-key code, .onboarding-command, .webhook-secret input'
                  )
              ]
            : [];
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

// Each area's global stylesheet is scoped to a class on <html> that the router sets, so both can
// be on the page at once (see router.js in horizon-fe). Returns the area class, the Element Plus
// primary colour, which marker selectors are loaded, and any rule with a marker that isn't
// scoped to its area.
const SITE_CSS = '.panel-box'; // only in the site stylesheet
const APP_CSS = '.h-data-grid'; // only in the app stylesheet
const SCOPES = { [SITE_CSS]: ':where(html.site-area) ', [APP_CSS]: ':where(html.app-area) ' };
async function css_state() {
    return page.evaluate(scopes => {
        const loaded = new Set();
        const unscoped = [];
        // Split a selector list on its top-level commas (not those inside :where(), :not(), ...)
        const split = text => {
            const out = [];
            let depth = 0;
            let start = 0;
            for (let i = 0; i < text.length; i++) {
                if (text[i] === '(') depth++;
                else if (text[i] === ')') depth--;
                else if (text[i] === ',' && depth === 0) {
                    out.push(text.slice(start, i).trim());
                    start = i + 1;
                }
            }
            out.push(text.slice(start).trim());
            return out;
        };
        const walk = rules => {
            for (const rule of rules) {
                if (rule.cssRules) walk(rule.cssRules); // @media
                if (!rule.selectorText) continue;
                for (const selector of split(rule.selectorText)) {
                    for (const [marker, scope] of Object.entries(scopes)) {
                        if (!selector.includes(marker)) continue;
                        loaded.add(marker);
                        if (!selector.startsWith(scope)) unscoped.push(selector);
                    }
                }
            }
        };
        for (const sheet of document.styleSheets) {
            try {
                walk(sheet.cssRules);
            } catch {} // cross-origin CDN sheets
        }
        const html = document.documentElement;
        return {
            area: ['site-area', 'app-area'].filter(c => html.classList.contains(c)).join(),
            primary: getComputedStyle(html).getPropertyValue('--el-color-primary').trim(),
            loaded: [...loaded].sort(),
            unscoped: unscoped.slice(0, 5)
        };
    }, SCOPES);
}
function check_css(state, where, area, primary, marker) {
    check(state.area === area, `${where}: <html> has area class "${state.area}" (want ${area})`);
    check(
        state.primary === primary,
        `${where}: Element primary is ${state.primary} (want ${primary})`
    );
    check(state.loaded.includes(marker), `${where}: its own CSS (${marker}) isn't loaded`);
    check(!state.unscoped.length, `${where}: unscoped area CSS: ${state.unscoped}`);
}
const SITE_PRIMARY = '#409eff'; // Element Plus's default
const APP_PRIMARY = '#6858ab'; // element-theme.scss

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
// The account's API keys before this run (#138), so it revokes only the ones it made
let initial_key_ids = null;

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
            results.observed.public_pages[p] = await css_state();
            check_css(results.observed.public_pages[p], p, 'site-area', SITE_PRIMARY, SITE_CSS);
        }
        // Signed out, the app sends you to the login page
        await page.goto(APP_URL);
        await page.waitForURL(u => u.pathname === '/login', { timeout: 15000 });
    });

    await step('login', async () => {
        await page.goto(`${FE_URL}/login`);
        await page.getByPlaceholder('Email').fill(EMAIL);
        await page.getByPlaceholder('Password').fill(PASSWORD);
        // Gone after a full page load: signing in should move to the app through the router
        await page.evaluate(() => (window.__ui_smoke_same_page = true));
        await page.locator('.login-button').click();
        await page.waitForURL(u => u.href.startsWith(APP_URL), { timeout: 30000 });
        await page.locator('.layout .header-text', { hasText: EMAIL }).waitFor();
        results.observed.token_in_url = page.url().includes('token');
        check(!results.observed.token_in_url, `session token is in the URL: ${page.url()}`);
        results.observed.login_same_page = await page.evaluate(
            () => window.__ui_smoke_same_page === true
        );
        check(results.observed.login_same_page, 'signing in reloaded the page (want the router)');
        // Both areas' CSS is on the page now; only the app's applies
        results.observed.app_css = await css_state();
        check_css(results.observed.app_css, 'the app', 'app-area', APP_PRIMARY, APP_CSS);
        check(
            results.observed.app_css.loaded.includes(SITE_CSS),
            `the site's CSS isn't loaded after signing in (have ${results.observed.app_css.loaded})`
        );
    });

    // The onboarding checklist (#143), unless this account dismissed it: four steps; it makes a
    // read-only key (#138), shown once, and the command carries it; then it's folded away so it
    // covers nothing below. The keys this run makes are revoked in api_key_and_external_api.
    await step('onboarding_checklist', async () => {
        const s = await be_session();
        const view = await be('GET', '/onboarding', { token: s.token });
        const keys_before = await be('GET', '/api-key', { token: s.token });
        initial_key_ids = new Set((keys_before.keys || []).map(k => k.id));
        await be('GET', `/auth/logout?token=${s.token}`).catch(() => {});
        results.observed.onboarding_shown = view.show;
        const box = page.locator('.onboarding');
        if (!view.show) {
            await sleep(1000);
            check((await box.count()) === 0, 'the dismissed checklist is on the page');
            return;
        }
        await box.waitFor();
        const steps = await box
            .locator('.onboarding-step')
            .evaluateAll(els => els.map(el => el.getAttribute('data-step')));
        results.observed.onboarding_steps = steps;
        check(
            steps.join() === 'create_table,view_api_key,copy_command,call_api',
            `checklist steps are ${steps}`
        );
        const key_step = box.locator('.onboarding-step[data-step="view_api_key"]');
        if (view.first_call) {
            const cmd = await box.locator('.onboarding-command').textContent();
            check(
                cmd.includes(view.first_call.key_placeholder),
                "the checklist's command has no key placeholder before a key is made"
            );
        }
        await key_step.getByRole('button', { name: 'Make a read-only key' }).click();
        const key_code = key_step.locator('.onboarding-key code');
        await key_code.waitFor();
        const key = (await key_code.textContent()).trim();
        check(key.length === 32, 'the checklist shows no API key');
        if (view.first_call) {
            const cmd = await box.locator('.onboarding-command').textContent();
            check(cmd.includes(key), "the checklist's command doesn't carry the new key");
        }
        await box.locator('.onboarding-toggle').click();
        await box.locator('.onboarding-steps').waitFor({ state: 'detached' });
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
    // Get, which sends a real (read-only) request with a key: the checklist's, or (when this
    // account dismissed the checklist) one made here and pasted in, as a person would (#138)
    await step('table_api_docs', async () => {
        await grid().locator('.api-button button').click();
        const dialog = page.locator('.container-dialog .api-dialog');
        const tabs = dialog.locator('.api-dialog-tab');
        await tabs.first().waitFor();
        const try_key = dialog.locator('.try-key');
        if (!(await try_key.inputValue())) {
            const made = await be('POST', '/api-key', {
                token: be_s.token,
                body: { name: 'ui-smoke docs', access: 'read' }
            });
            check(made && made.secret, `couldn't make a key: ${JSON.stringify(made)}`);
            await try_key.fill(made.secret);
        }
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

    // Webhooks (#140): a private URL is refused; one added for this table shows its secret,
    // sends a test event (it appears in its delivery log), is disabled and then deleted. Its URL
    // is on example.com, so only that the test event was queued and logged is checked, not
    // that example.com accepted it. Deleting the table would remove it too.
    await step('table_webhooks', async () => {
        await grid().locator('.webhooks-button button').click();
        const dialog = page.locator('.container-dialog .webhooks-dialog');
        await dialog.locator('.webhooks-add').waitFor();
        await dialog
            .locator('.webhooks-status', { hasText: 'Loading' })
            .waitFor({ state: 'detached' });
        check((await dialog.locator('.webhook').count()) === 0, 'the table already has webhooks');
        // The intro names the table as the title does, without the file's `.g` (#189)
        const intro_name = (await dialog.locator('.webhooks-intro b').first().innerText()).trim();
        check(intro_name === TABLE, `the webhooks intro names the table "${intro_name}"`);
        const url_input = dialog.locator('.webhooks-url');
        const add = dialog.getByRole('button', { name: 'Add webhook' });
        await url_input.fill('http://127.0.0.1/hook');
        await add.click();
        const error = dialog.locator('.webhooks-status.error');
        await error.waitFor();
        results.observed.webhook_private_error = (await error.innerText()).trim();
        check(
            /private or internal/.test(results.observed.webhook_private_error),
            `a loopback webhook URL showed "${results.observed.webhook_private_error}"`
        );
        check((await dialog.locator('.webhook').count()) === 0, 'a loopback webhook was added');

        await url_input.fill('https://example.com/invokedb-ui-smoke');
        await add.click();
        const hook = dialog.locator('.webhook');
        await hook.waitFor();
        check(
            /^whsec_/.test(await hook.locator('.webhook-secret input').inputValue()),
            "the new webhook doesn't show its secret"
        );
        const listed = await be('GET', `/webhook?table=${file_id}`, { token: be_s.token });
        const saved = (listed.webhooks || []).filter(h => h.file_id === file_id);
        check(
            saved.length === 1 && saved[0].enabled && saved[0].events.length === 3,
            `the backend has ${JSON.stringify(saved)}`
        );
        results.observed.webhook_events = saved[0] && saved[0].events;

        await hook.getByRole('button', { name: 'Send test event', exact: true }).click();
        const delivery = hook.locator('.webhook-delivery');
        await delivery.first().waitFor();
        results.observed.webhook_test_event = (
            await delivery.first().locator('code').innerText()
        ).trim();
        check(
            results.observed.webhook_test_event === 'ping',
            `the delivery log shows "${results.observed.webhook_test_event}"`
        );

        await hook.getByRole('button', { name: 'Disable', exact: true }).click();
        await hook.getByRole('button', { name: 'Enable', exact: true }).waitFor();
        const off = await be('GET', `/webhook?table=${file_id}`, { token: be_s.token });
        check(
            (off.webhooks || []).some(h => h.id === saved[0].id && h.enabled === false),
            'Disable did not disable the webhook'
        );

        await hook.getByRole('button', { name: 'Delete', exact: true }).click();
        await page
            .locator('.confirm-dialog .el-dialog')
            .getByRole('button', { name: 'Confirm' })
            .click();
        await hook.waitFor({ state: 'detached' });
        const gone = await be('GET', `/webhook?table=${file_id}`, { token: be_s.token });
        check(
            !(gone.webhooks || []).some(h => h.id === saved[0].id),
            'the deleted webhook is still in the backend'
        );
        await page.locator('.container-dialog .el-dialog__headerbtn').click();
        await dialog.waitFor({ state: 'detached' });
    });

    // Ask your data (#149). The Ask button shows only when the backend has AI set up. On the
    // smoke stack (smoke-env.sh points ANTHROPIC_BASE_URL at 127.0.0.1:8197) a stub of the
    // Anthropic API answers, so a question is asked and its answer, rows and curl are checked.
    // Anywhere else (production) the dialog is only opened, so no real model is called.
    await step('ask_your_data', async () => {
        const status = await be('GET', '/ai/status', { token: be_s.token });
        const button = grid().locator('.ask-data-button button');
        results.observed.ai_available = !!status.available;
        if (!status.available) {
            check((await button.count()) === 0, 'the Ask button shows without AI set up');
            return;
        }
        await button.click();
        const dialog = page.locator('.container-dialog .ask-dialog');
        await dialog.locator('.ask-usage').waitFor();
        if (ai_stub) {
            await dialog.locator('.ask-question').fill('How many people are there?');
            await dialog.getByRole('button', { name: 'Ask', exact: true }).click();
            const answer = dialog.locator('.ask-answer');
            await answer.waitFor();
            const text = (await answer.innerText()).trim();
            const rows = await dialog.locator('.ask-rows tbody tr').count();
            const curl = await dialog.locator('.ask-call').innerText();
            results.observed.ai_answer = text;
            check(text === `Stub: ${rows} rows match`, `the answer is "${text}" with ${rows} rows`);
            check(rows > 0, 'the Ask dialog shows no rows');
            check(
                curl.includes(`/v1/query?table=${TABLE}`) && curl.includes('Authorization'),
                `the API call shown is ${curl}`
            );
            check(
                (await dialog.locator('.ask-usage').innerText()).includes('questions used'),
                "the Ask dialog doesn't show the usage"
            );
        }
        await page.locator('.container-dialog .el-dialog__headerbtn').click();
        await dialog.waitFor({ state: 'detached' });
    });

    // API keys (#138): go to the Account page through the API docs' "account" link (a router
    // link, not the nav): only Account is highlighted in the nav afterwards, not Api as well
    // (#189). Then make a read-only key limited to the table, read it (shown once), call /api/v1
    // with it (a read works, a write is refused), see it listed by its prefix only, revoke it and
    // see it refused; then revoke the other keys this run made.
    await step('api_key_and_external_api', async () => {
        await page.locator('.layout .nav .el-menu-item', { hasText: 'Api' }).click();
        await page.locator('.api-key-message a', { hasText: 'account' }).click();
        const form = page.locator('.api-key-form');
        await form.locator('.api-key-new-button').waitFor();
        const highlighted = async cls =>
            (await page.locator(`.layout .nav .el-menu-item.${cls}`).allInnerTexts()).map(t =>
                t.trim()
            );
        results.observed.nav_active_after_docs_link = await highlighted('is-active');
        check(
            results.observed.nav_active_after_docs_link.join() === 'Account' &&
                (await highlighted('is-active2')).join() === 'Account',
            `after the docs' account link the nav highlights ${JSON.stringify(results.observed.nav_active_after_docs_link)}`
        );
        await form.locator('.api-key-new-button').click();
        await form.locator('.api-key-name input').fill('ui-smoke');
        await form.locator('.api-key-scope').getByText('Only these').click();
        await form.locator('.api-key-tables').click();
        await page.locator('.el-select-dropdown__item:visible', { hasText: TABLE }).click();
        await form.locator('.api-key-name input').click();
        await form.locator('.api-key-save').click();
        const secret = form.locator('.api-key-secret');
        await secret.waitFor();
        const key = await secret.inputValue();
        check(key.length === 32, 'the new API key is not shown');
        // Find the row by the key's prefix and its exact name: "ui-smoke docs" (made in
        // table_api_docs) and revoked keys from earlier runs contain "ui-smoke" too
        const item = form
            .locator('.api-key-item', { hasText: key.slice(0, 6) })
            .filter({ has: page.locator('.api-key-item-name', { hasText: /^ui-smoke$/ }) });
        await item.waitFor();
        const item_text = await item.innerText();
        check(
            item_text.includes(key.slice(0, 6)) && !item_text.includes(key),
            `the key is listed as ${item_text}`
        );
        check(item_text.includes(TABLE), `the key's tables are listed as ${item_text}`);

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
        const write = await fetch(`${API_URL}/v1/create?table=${TABLE}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify([{ name: 'refused' }])
        });
        check(write.status === 403, `/api/v1/create with a read-only key -> ${write.status}`);

        await form.getByRole('button', { name: "I've saved it" }).click();
        await secret.waitFor({ state: 'detached' });
        await item.locator('.api-key-revoke').click();
        await page
            .locator('.confirm-dialog .el-dialog')
            .getByRole('button', { name: 'Confirm' })
            .click();
        await form.locator('.api-key-item.revoked', { hasText: key.slice(0, 6) }).waitFor();
        const after = await fetch(`${API_URL}/v1/get?table=${TABLE}&skip=0&limit=1`, {
            headers: { Authorization: `Bearer ${key}` }
        });
        check(after.status === 401, `/api/v1/get with the revoked key -> ${after.status}`);

        // The checklist's key and any made for "Try it"
        const { keys } = await be('GET', '/api-key', { token: be_s.token });
        for (const k of keys || []) {
            if (initial_key_ids && !initial_key_ids.has(k.id) && !k.revoked_datetime) {
                await be('DELETE', `/api-key/${k.id}`, { token: be_s.token });
            }
        }
        await page.locator('.layout .nav .el-menu-item', { hasText: 'Tables' }).click();
    });

    // Shareable forms (#145): make a form from two of the table's columns (one required), open
    // its public link in a new tab, see the required check, submit it and find the row in the
    // backend; then close the form (its link answers "closed") and delete it (the link is gone).
    // After the API key step, which counts the table's rows.
    await step('table_forms', async () => {
        await page.locator('.el-tabs__item', { hasText: TABLE }).click();
        await grid().locator('.forms-button button').click();
        const dialog = page.locator('.container-dialog .forms-dialog');
        await dialog.locator('.forms-new-button').waitFor();
        check((await dialog.locator('.form-item').count()) === 0, 'the table already has forms');
        await dialog.getByRole('button', { name: 'New form' }).click();
        const editor = dialog.locator('.form-editor');
        await editor.waitFor();
        await editor.locator('.form-editor-title').fill('UI smoke form');
        const column_row = name => editor.locator('.form-editor-column', { hasText: name });
        await column_row('name').locator('.form-editor-required').check();
        await column_row('city').locator('.form-editor-ask').uncheck();
        await editor.locator('.form-editor-thank-you').fill('Thanks from the UI smoke test');
        await editor.getByRole('button', { name: 'Create form' }).click();
        const item = dialog.locator('.form-item');
        await item.waitFor();
        await editor.waitFor({ state: 'detached' });
        const link = await item.locator('.form-item-link input').inputValue();
        check(
            /\/f\/form_[0-9a-f]{24}$/.test(link) && link.startsWith(FE_URL),
            `the form's link is "${link}"`
        );
        check(
            (await item.locator('.form-item-embed input').inputValue()).includes(`${link}?embed=1`),
            "the embed code doesn't point at the form"
        );
        const form_id = link.split('/f/')[1];
        const listed = await be('GET', `/form?table=${file_id}`, { token: be_s.token });
        const saved = (listed.forms || []).find(f => f.id === form_id);
        results.observed.form_fields = saved && saved.fields.map(f => [f.required]);
        check(
            saved && saved.open && saved.fields.length === 2 && saved.fields[0].required,
            `the backend has ${JSON.stringify(saved)}`
        );

        const visitor = await context.newPage();
        try {
            await visitor.goto(link);
            await visitor.locator('.form-page .form-title', { hasText: 'UI smoke form' }).waitFor();
            const labels = await visitor.locator('.form-field label').allInnerTexts();
            results.observed.form_labels = labels.map(l => l.replace(/\s+/g, ' ').trim());
            check(
                results.observed.form_labels.join(',') === 'name *,age',
                `the public form asks ${results.observed.form_labels}`
            );
            check(
                (await visitor.locator('.form-field input').nth(1).getAttribute('type')) ===
                    'number',
                'the number column is not a number input'
            );
            await visitor.getByRole('button', { name: 'Submit' }).click();
            await visitor.locator('.form-error', { hasText: 'required' }).waitFor();
            await visitor.locator('.form-field input').nth(0).fill('ui-smoke-form');
            await visitor.locator('.form-field input').nth(1).fill('7');
            await visitor.getByRole('button', { name: 'Submit' }).click();
            await visitor
                .locator('.form-done', { hasText: 'Thanks from the UI smoke test' })
                .waitFor();
        } finally {
            await visitor.close();
        }
        const after = await be_table(be_s, file_id);
        const row = after.rows.find(r => r.name === 'ui-smoke-form');
        check(row && row.age === 7, `the submitted row is ${JSON.stringify(row)}`);

        await item.getByRole('button', { name: 'Close form' }).click();
        await item.getByRole('button', { name: 'Reopen form' }).waitFor();
        const closed = await fetch(`${BE_URL}/public/form/${form_id}`);
        check(closed.status === 410, `a closed form's link answers ${closed.status}`);

        await item.getByRole('button', { name: 'Delete', exact: true }).click();
        await page
            .locator('.confirm-dialog .el-dialog')
            .getByRole('button', { name: 'Confirm' })
            .click();
        await item.waitFor({ state: 'detached' });
        const gone = await fetch(`${BE_URL}/public/form/${form_id}`);
        check(gone.status === 404, `a deleted form's link answers ${gone.status}`);
        await page.locator('.container-dialog .el-dialog__headerbtn').click();
        await dialog.waitFor({ state: 'detached' });
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
    });

    // Saved views (#146), on the tasks table: save the grid's filter and sort as a view, switch
    // to all rows and back (the filter row shows the view's filter), rename it; a kanban view by
    // Status where dragging a card changes the row; a bar chart of rows per Status; then delete
    // the views.
    await step('table_views', async () => {
        const [tasks] = await find_tables(be_s, TEMPLATE_TABLE);
        const views_menu = async item => {
            await grid().locator('.views-menu-button').click();
            const menu = page.locator('.views-menu:visible');
            await menu.waitFor();
            await menu.locator('.el-dropdown-menu__item', { hasText: item }).first().click();
        };
        const dialog = page.locator('.container-dialog .views-dialog');
        const open_dialog = async () => {
            await views_menu('Save or manage views');
            await dialog.locator('.views-new-button').waitFor();
        };
        const close_dialog = async () => {
            await page.locator('.container-dialog .el-dialog__headerbtn').click();
            await dialog.waitFor({ state: 'detached' });
        };
        const current = () => grid().locator('.views-button .views-current').innerText();
        const owner_filter = grid().locator(
            `.ag-floating-filter[col-id="${await col_id('Owner')}"] .custom-filter-text`
        );

        // A grid view: Owner contains "Sam", sorted by Estimate Hours
        await owner_filter.pressSequentially('Sam');
        await wait_rows(r => r.length === 2, 'Owner contains "Sam" filter');
        await grid()
            .locator(
                `.ag-header-cell[col-id="${await col_id('Estimate Hours')}"] .grid-header.read`
            )
            .click();
        await wait_rows(
            r => r[0]['Task'] === 'Fix the signup email typo',
            'ascending Estimate Hours sort'
        );
        await open_dialog();
        check((await dialog.locator('.view-item').count()) === 0, 'the table already has views');
        await dialog.locator('.views-new-button').click();
        await dialog.locator('.view-editor-name').fill('UI smoke Sam');
        await dialog.locator('.view-save-button').click();
        await dialog.waitFor({ state: 'detached' });
        check((await current()) === 'UI smoke Sam', `the current view is "${await current()}"`);
        const listed = await be('GET', `/view?table=${tasks.id}`, { token: be_s.token });
        const saved = (listed.views || [])[0];
        results.observed.view_saved =
            saved && saved.filters.map(f => [f.type, f.value]).concat([[saved.sort?.dir]]);
        check(
            saved &&
                saved.type === 'grid' &&
                saved.filters.length === 1 &&
                saved.filters[0].value === 'Sam' &&
                saved.sort?.dir === 'asc',
            `the saved view is ${JSON.stringify(saved)}`
        );

        // All rows, then the view again: its filter comes back in the filter row
        await views_menu('All rows');
        await wait_rows(r => r.length === 4, 'all rows');
        check((await owner_filter.inputValue()) === '', 'the Owner filter is still set');
        await views_menu('UI smoke Sam');
        await wait_rows(r => r.length === 2, "the view's filter");
        check(
            (await owner_filter.inputValue()) === 'Sam',
            `the Owner filter shows "${await owner_filter.inputValue()}"`
        );

        // Renamed
        await open_dialog();
        const item = dialog.locator('.view-item', { hasText: 'UI smoke Sam' });
        await item.locator('.view-rename-button').click();
        // Renaming swaps the name for an input (whose value isn't text), so `item` no longer
        // matches; only one view is renamed at a time, so find the input in the dialog
        await dialog.locator('.view-rename-input').fill('UI smoke Sam renamed');
        await dialog.locator('.view-rename-save').click();
        await dialog.locator('.view-item-name', { hasText: 'UI smoke Sam renamed' }).waitFor();
        await close_dialog();
        check(
            (await current()) === 'UI smoke Sam renamed',
            `the current view is "${await current()}" after renaming`
        );

        // Kanban by Status, from all rows: drag "Write the launch post" to Done
        await views_menu('All rows');
        await wait_rows(r => r.length === 4, 'all rows');
        await open_dialog();
        await dialog.locator('.views-new-button').click();
        await dialog.locator('.view-editor-name').fill('UI smoke board');
        await dialog.locator('.view-type-kanban').click();
        await dialog.locator('.view-editor-group').selectOption({ label: 'Status' });
        await dialog.locator('.view-save-button').click();
        await dialog.waitFor({ state: 'detached' });
        const column = value => grid().locator(`.kanban-column[data-value="${value}"]`);
        await column('To do').locator('.kanban-card').nth(1).waitFor();
        results.observed.kanban_columns = await grid()
            .locator('.kanban-column-name')
            .allInnerTexts();
        check(
            results.observed.kanban_columns.join() === 'Done,In progress,To do',
            `the board's columns are ${results.observed.kanban_columns}`
        );
        // The board's own drag events (dragstart on the card, dragover and drop on the column,
        // sharing one DataTransfer) rather than a mouse gesture. On production a mouse drag
        // (dragTo, then by hand with several moves) kept turning into a text selection in
        // headless Chromium, so no drag started and the column never got its dragover. The
        // events run the same handlers a real drag does.
        const card = column('In progress').locator('.kanban-card', {
            hasText: 'Write the launch post'
        });
        const data_transfer = await page.evaluateHandle(() => new DataTransfer());
        await card.dispatchEvent('dragstart', { dataTransfer: data_transfer });
        await column('Done').dispatchEvent('dragover', { dataTransfer: data_transfer });
        await grid().locator('.kanban-column.drop-target[data-value="Done"]').waitFor();
        // The drop moves the card (so `card` no longer matches) and clears the drag itself
        await column('Done').dispatchEvent('drop', { dataTransfer: data_transfer });
        await data_transfer.dispose();
        await column('Done')
            .locator('.kanban-card', { hasText: 'Write the launch post' })
            .waitFor();
        const end = Date.now() + 10000;
        let moved;
        while (Date.now() < end) {
            const rows = (await be_table(be_s, tasks.id)).rows;
            moved = rows.find(r => r.Task === 'Write the launch post');
            if (moved && moved.Status === 'Done') break;
            await sleep(250);
        }
        check(moved && moved.Status === 'Done', `the moved row is ${JSON.stringify(moved)}`);

        // A bar chart of rows per Status
        await views_menu('All rows');
        await wait_rows(r => r.length === 4, 'all rows');
        await open_dialog();
        await dialog.locator('.views-new-button').click();
        await dialog.locator('.view-editor-name').fill('UI smoke chart');
        await dialog.locator('.view-type-chart').click();
        await dialog.locator('.view-editor-kind').selectOption('bar');
        await dialog.locator('.view-editor-chart-field').selectOption({ label: 'Status' });
        await dialog.locator('.view-save-button').click();
        await dialog.waitFor({ state: 'detached' });
        await grid().locator('.chart-svg .chart-mark').nth(1).waitFor();
        results.observed.chart_numbers = await grid().locator('.chart-table td').allTextContents();
        check(
            results.observed.chart_numbers.map(t => t.trim()).join() === 'Done,2,To do,2',
            `the chart's numbers are ${results.observed.chart_numbers}`
        );

        // Deleted: the chart (shown) too, so the grid comes back
        await open_dialog();
        for (let i = 0; i < 3; i++) {
            await dialog.locator('.view-delete-button').first().click();
            await page
                .locator('.confirm-dialog .el-dialog')
                .getByRole('button', { name: 'Confirm' })
                .click();
            await dialog
                .locator('.view-item')
                .nth(2 - i)
                .waitFor({ state: 'detached' });
        }
        await close_dialog();
        check((await current()) === 'Views', `the current view is "${await current()}"`);
        const after = await be('GET', `/view?table=${tasks.id}`, { token: be_s.token });
        check((after.views || []).length === 0, `views left: ${JSON.stringify(after.views)}`);
    });

    await step('delete_template_table', async () => {
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

    // Table from a URL (#144): the server fetches the CSV; the grid's Sync button opens its source
    await step('table_from_url', async () => {
        await page.locator('.h-tree-controls .title-icon').click();
        await page
            .locator('.h-tree-menu-popper')
            .getByText('Table from URL or Google Sheet')
            .click();
        const dlg = page.locator('.url-import-dialog .el-dialog');
        await dlg.locator('.new-name input').fill(URL_TABLE);
        await dlg.locator('.source-url input').fill(URL_SOURCE);
        await dlg.getByRole('button', { name: 'Import' }).click();
        await page.locator('.el-tabs__item', { hasText: URL_TABLE }).waitFor();
        await wait_rows(
            r => r[0].name === 'Renew car registration',
            'the rows fetched from the URL',
            45000
        );
        const tables = await find_tables(be_s, URL_TABLE);
        check(tables.length === 1, `expected 1 "${URL_TABLE}" table, found ${tables.length}`);
        const saved = await be_table(be_s, tables[0].id);
        results.observed.url_columns = saved.columns.map(c => c.name);
        check(
            results.observed.url_columns.join() === 'name,is_complete,priority,due_date',
            `URL table columns are ${results.observed.url_columns}`
        );
        check(saved.rows.length === 24, `URL table has ${saved.rows.length} rows, not 24`);

        await grid().locator('.url-source-button').click();
        const source_url = await dlg.locator('.source-url input').inputValue();
        check(source_url === URL_SOURCE, `the source dialog shows ${source_url}`);
        await dlg.getByRole('button', { name: 'Cancel' }).click();
        await dlg.waitFor({ state: 'hidden' });

        await page.locator('.h-tree .tree-wrapper').getByText(URL_TABLE, { exact: true }).click();
        await page.locator('.h-tree .manage-items.active .remove-items').click();
        await page
            .locator('.confirm-dialog .el-dialog')
            .getByRole('button', { name: 'Confirm' })
            .click();
        await page.locator('.el-tabs__item', { hasText: URL_TABLE }).waitFor({ state: 'detached' });
        check((await find_tables(be_s, URL_TABLE)).length === 0, 'URL table still exists');
    });

    // A link column (#147): the uploaded table gets a "task" column linking to a tasks table,
    // one cell is filled from the picker and shows the task's name, and its chip opens the
    // tasks table. The tasks table is then deleted through the UI.
    await step('link_column', async () => {
        await page.locator('.h-tree-controls .title-icon').click();
        await page.locator('.h-tree-menu-popper').getByText('Table from Template').click();
        const tpl = page.locator('.template-dialog .el-dialog');
        await tpl.locator('.template-item[data-template-id="tasks"]').click();
        await tpl.locator('.new-name input').fill(LINK_TABLE);
        await tpl.getByRole('button', { name: 'Create' }).click();
        await page.locator('.el-tabs__item', { hasText: LINK_TABLE }).waitFor();
        await wait_rows(r => r.length === 4, 'the tasks table rows');

        // Back to the uploaded table (still open in its tab; a single click on a tree item
        // only highlights it), and add the link column
        await page.locator('.el-tabs__item', { hasText: TABLE }).click();
        await page.locator('.el-tabs__item.is-active', { hasText: TABLE }).waitFor();
        await grid().getByRole('button', { name: 'Edit Columns' }).click();
        const inputs = grid().locator('.ag-header-row .grid-header.edit .grid-header-input input');
        await inputs.first().waitFor();
        const before = await inputs.count();
        await grid().getByRole('button', { name: 'Add Column' }).click();
        await inputs.nth(before).waitFor();
        await inputs.nth(before).pressSequentially('task');
        const header = await edit_header('task');
        await header.locator('.active-column-type').click();
        await page.locator('.grid-header-type__menu:visible .menu__item.link').click();
        const settings = page.locator('.link-dialog');
        await settings.locator('.link-table-select').click();
        await page.locator('.el-select-dropdown__item:visible', { hasText: LINK_TABLE }).click();
        await settings.locator('.link-save').click();
        await settings.waitFor({ state: 'detached' });
        await grid().locator('.commit-controls .blue').click();
        await wait_idle();
        await page.waitForFunction(() => !document.querySelector('.h-data-grid.edit-column-mode'));
        const hend = Date.now() + 10000;
        while (Date.now() < hend && !(await headers()).includes('task')) await sleep(250);
        const link_table = (await find_tables(be_s, LINK_TABLE))[0];
        check(!!link_table, `no "${LINK_TABLE}" table in the backend`);
        let saved = await be_table(be_s, file_id);
        const task_col = saved.columns.find(c => c.name === 'task');
        check(task_col && task_col.type === 'link', `task column is ${JSON.stringify(task_col)}`);

        // Fill one cell from the picker
        const task_id = await col_id('task');
        await grid().locator(`.ag-row[row-index="0"] .ag-cell[col-id="${task_id}"]`).dblclick();
        const picker = page.locator('.link-dialog');
        await picker.locator('.link-row-select').click();
        await picker.locator('.link-row-select input').fill('launch');
        await page.locator('.el-select-dropdown__item:visible', { hasText: LINKED_TASK }).click();
        // A multiple select stays open; a click outside it closes it before Save
        await picker.locator('.link-intro').click();
        await picker.locator('.link-save').click();
        await picker.waitFor({ state: 'detached' });
        results.observed.link_rows = await wait_rows(
            r => r.some(row => row.task === LINKED_TASK),
            'the linked task in the grid'
        );
        saved = await be_table(be_s, file_id);
        const linked = saved.rows.filter(r => Array.isArray(r.task) && r.task.length === 1);
        check(linked.length === 1, `rows with a link: ${JSON.stringify(saved.rows)}`);

        // Its chip opens the linked table
        await grid().locator('.link-chip', { hasText: LINKED_TASK }).first().click();
        await page.locator('.el-tabs__item.is-active', { hasText: LINK_TABLE }).waitFor();

        // The schema diagram (#208) draws both tables and the link; clicking a card opens it
        await page.locator('.h-tree .schema-diagram-button').click();
        const diagram = page.locator('.container-dialog .schema-diagram');
        const table_card = diagram.locator(`.schema-table[data-table-id="${file_id}"]`);
        await table_card.waitFor();
        await diagram.locator(`.schema-table[data-table-id="${link_table.id}"]`).waitFor();
        check(
            (await diagram.locator('.schema-edge:not(.suggested)').count()) >= 1,
            'no link arrow in the schema diagram'
        );
        await table_card.click();
        await diagram.waitFor({ state: 'detached' });
        await page.locator('.el-tabs__item.is-active', { hasText: TABLE }).waitFor();

        await page.locator('.h-tree .tree-wrapper').getByText(LINK_TABLE, { exact: true }).click();
        await page.locator('.h-tree .manage-items.active .remove-items').click();
        await page
            .locator('.confirm-dialog .el-dialog')
            .getByRole('button', { name: 'Confirm' })
            .click();
        await page
            .locator('.el-tabs__item', { hasText: LINK_TABLE })
            .waitFor({ state: 'detached' });
        check((await find_tables(be_s, LINK_TABLE)).length === 0, 'link table still exists');
    });

    // AI rows and tables (#148), only against the Anthropic stub, so a run against production
    // never calls (and pays for) the real model. Asking Ask AI for rows (#234) shows them in the
    // dialog, "Add to table" puts them in the grid as new rows and Save adds them; a table from a
    // description is previewed in its dialog and created with its columns and rows.
    if (!ai_stub) {
        results.steps.ai_rows_and_table = 'skipped';
        console.log('skip ai_rows_and_table (no Anthropic stub: not the smoke stack)');
    } else {
        await step('ai_rows_and_table', async () => {
            await page.locator('.h-tree .tree-wrapper').getByText(TABLE, { exact: true }).click();
            await page.locator('.el-tabs__item.is-active', { hasText: TABLE }).waitFor();
            await grid().locator('.ask-data-button button').click();
            const gen = page.locator('.container-dialog .ask-dialog');
            await gen.locator('.ask-question').fill('add two more people');
            await gen.getByRole('button', { name: 'Ask', exact: true }).click();
            await gen.locator('.ask-proposed-row').nth(1).waitFor({ timeout: 30000 });
            check(
                (await gen.locator('.ask-proposed-row').count()) === 2,
                "Ask AI doesn't show the 2 proposed rows"
            );
            await gen.locator('.ask-add-rows').click();
            await gen.waitFor({ state: 'detached', timeout: 10000 });
            // The stub's text values are "<column> <n>"
            await wait_rows(r => r.some(row => row.name === 'name 2'), 'the generated rows');
            let saved = await be_table(be_s, file_id);
            check(!saved.rows.some(r => r.name === 'name 1'), 'generated rows saved before Save');
            await grid().locator('.commit-controls .blue').click();
            const end = Date.now() + 10000;
            while (Date.now() < end && !saved.rows.some(r => r.name === 'name 2')) {
                await sleep(250);
                saved = await be_table(be_s, file_id);
            }
            const made = saved.rows.filter(r => /^name [12]$/.test(r.name));
            results.observed.ai_rows = made;
            check(made.length === 2, `generated rows saved: ${JSON.stringify(saved.rows)}`);
            const types = Object.fromEntries(saved.columns.map(c => [c.name, c.type]));
            check(
                made.every(r =>
                    Object.entries(r).every(
                        ([k, v]) => v == null || types[k] !== 'number' || typeof v === 'number'
                    )
                ),
                `generated rows don't fit the column types: ${JSON.stringify(made)}`
            );

            await page.locator('.h-tree-controls .title-icon').click();
            await page
                .locator('.h-tree-menu-popper')
                .getByText('Table from a Description (AI)')
                .click();
            const dlg = page.locator('.container-dialog .ai-table-dialog');
            await dlg.locator('.ai-description').fill('a CRM for a dog groomer');
            await dlg.locator('.ai-count').fill('2');
            await dlg.locator('.ai-generate').click();
            await dlg.locator('.ai-table-name').waitFor({ timeout: 30000 });
            check(
                (await dlg.locator('.ai-preview-row').count()) === 2,
                "the preview doesn't show 2 rows"
            );
            await dlg.locator('.ai-table-name').fill(AI_TABLE);
            await dlg.locator('.ai-create').click();
            await page.locator('.el-tabs__item', { hasText: AI_TABLE }).waitFor();
            await wait_rows(r => r.length === 2, 'the new table rows');
            const [table] = await find_tables(be_s, AI_TABLE);
            check(!!table, `no "${AI_TABLE}" table in the backend`);
            const ai_saved = await be_table(be_s, table.id);
            results.observed.ai_table_columns = ai_saved.columns.map(c => `${c.name}:${c.type}`);
            check(
                results.observed.ai_table_columns.join() === 'Name:string,Amount:number,Date:date',
                `AI table columns are ${results.observed.ai_table_columns}`
            );
            await be('POST', '/file-directory/batch_delete', {
                token: be_s.token,
                body: { ids: [table.id] }
            });
        });
    }

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
    if (ai_stub) ai_stub.close();
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
