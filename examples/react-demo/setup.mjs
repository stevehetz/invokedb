// One-time setup of the support desk's InvokeDB account. Run it once against production (or
// a local backend to try the app), signed in as the account the demo uses:
//
//   INVOKEDB_PASSWORD=... node examples/react-demo/setup.mjs --email support-demo@invokedb.com \
//       [--base https://api.invokedb.com] [--code 123456] [--replace] \
//       [--webhook-url https://examples.invokedb.com/react-demo/webhook]
//
// It makes the Customers, Tickets and Comments tables (column types, indexes, link columns),
// a read-write API key for those three tables only, loads the seed rows (seed/seed.json), and
// creates the webhook (every row event, every table of the account) pointing at the server.
// Then it prints the lines for deploy/prod.env. Use a dedicated account for the demo, made
// internal in the admin area so its calls and rows aren't capped.
//
// Tables that already exist stop the script unless --replace is given, which deletes and
// re-creates them (and their rows). Each run makes a new key and webhook and removes the ones
// the last run made, so the printed values replace the old ones.
import { parseArgs } from 'node:util';
import { TABLES } from './server/schema.mjs';
import { createInvokeDB } from './server/invokedb.mjs';
import { loadSeed, resetData } from './server/reset.mjs';

const { values: opts } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:8001' },
    email: { type: 'string' },
    code: { type: 'string' },
    replace: { type: 'boolean', default: false },
    'webhook-url': {
      type: 'string',
      default: 'https://examples.invokedb.com/react-demo/webhook'
    }
  }
});
const BASE = opts.base.replace(/\/+$/, '');
const password = process.env.INVOKEDB_PASSWORD;
if (!opts.email || !password) {
  console.error('Usage: INVOKEDB_PASSWORD=... node setup.mjs --email <account> [--base <url>]');
  process.exit(1);
}
const KEY_NAME = 'React demo server (setup.mjs)';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** @param {string} method @param {string} url @param {{ token?: string, body?: unknown }} [opts] */
async function call(method, url, { token, body } = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(BASE + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    throw new Error(`Can't reach ${BASE} (${e.cause?.code || e.message})`, { cause: e });
  }
  const text = await res.text();
  /** @type {any} */
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: keep the text
  }
  if (!res.ok) {
    throw new Error(`${method} ${url} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// ---- sign in ----
let session = await call('POST', '/auth/login', { body: { email: opts.email, password } });
if (session.two_factor_required) {
  if (!opts.code) throw new Error('This account has two-factor sign-in on: pass --code <code>');
  session = await call('POST', '/auth/login/two-factor', {
    body: { challenge: session.challenge, code: opts.code }
  });
}
const token = session.token;
const me = await call('GET', `/auth/authorize?token=${encodeURIComponent(token)}`);
console.log(`Signed in as ${opts.email} (account ${me.id}) at ${BASE}`);

const listTables = () => call('GET', '/file-directory', { token });

async function waitUntilReady(fileId) {
  for (let i = 0; i < 120; i++) {
    const file = (await listTables()).find(d => d.id === fileId);
    if (!file) throw new Error(`table ${fileId} disappeared`);
    if (file.status === 'ERROR') throw new Error(`processing failed: ${file.status_reason}`);
    if (!file.status) return;
    await sleep(500);
  }
  throw new Error(`table ${fileId} still processing after 60s`);
}

// ---- tables ----
const existing = (await listTables()).filter(
  d => d.type === 'file' && TABLES.some(t => t.name.toLowerCase() === d.name.toLowerCase())
);
if (existing.length && !opts.replace) {
  console.error(
    `Already there: ${existing.map(d => d.name).join(', ')}. ` +
      'Re-run with --replace to delete and re-create them (with their rows).'
  );
  process.exit(1);
}
if (existing.length) {
  await call('POST', '/file-directory/batch_delete', {
    token,
    body: { ids: existing.map(d => d.id) }
  });
  console.log(`Deleted ${existing.map(d => d.name).join(', ')}`);
}

// Table name → { id, fields: column name → field ('a', 'b', ...) }
const made = {};
for (const table of TABLES) {
  const id = await call('POST', '/file-directory?no_file=true', {
    token,
    body: { account_id: me.id, name: table.name, type: 'file', web_file_type: 'data-grid' }
  });
  const fields = {};
  const columns = [];
  for (const col of table.columns) {
    const placeholder = await call('GET', `/web-file/${id}/get_new_column`, { token });
    const def = {
      ...placeholder,
      headerName: col.name,
      col_type: col.type,
      deleted: false
    };
    if (col.link) {
      const target = made[col.link.table];
      def.link_table_id = target.id;
      def.link_display_field = target.fields[col.link.display];
    }
    await call('PUT', `/web-file/${placeholder._id}/data_grid_column/${id}`, { token, body: def });
    fields[col.name] = placeholder.field;
    columns.push(def);
  }
  // Indexes are built by a job, as when they're turned on in the grid
  const indexed = columns
    .filter(c => table.columns.find(t => t.name === c.headerName)?.indexed)
    .map(c => ({ ...c, indexed: true }));
  if (indexed.length) {
    await call('PUT', `/web-file/batch_update_job/data_grid_column/${id}`, {
      token,
      body: indexed
    });
    await waitUntilReady(id);
  }
  made[table.name] = { id, fields };
  console.log(`- ${table.name}: made (${table.columns.length} columns)`);
}

// ---- the API key: read-write, these three tables only ----
const { keys } = await call('GET', '/api-key', { token });
for (const old of keys.filter(k => k.name === KEY_NAME && !k.revoked_datetime)) {
  await call('DELETE', `/api-key/${old.id}`, { token });
}
const { secret: apiKey } = await call('POST', '/api-key', {
  token,
  body: {
    name: KEY_NAME,
    access: 'read_write',
    table_ids: TABLES.map(t => made[t.name].id)
  }
});

// ---- seed rows ----
const db = createInvokeDB({ baseUrl: `${BASE}/api/v1`, apiKey });
const counts = await resetData(db, loadSeed());
console.log(
  `Loaded ${counts.customers} customers, ${counts.tickets} tickets, ${counts.comments} comments`
);

// ---- the webhook (made after the seed, so loading it sends nothing) ----
const webhookUrl = opts['webhook-url'];
const { webhooks } = await call('GET', '/webhook', { token });
for (const old of webhooks.filter(w => w.url === webhookUrl)) {
  await call('DELETE', `/webhook/${old.id}`, { token });
}
const hook = await call('POST', '/webhook', {
  token,
  body: {
    url: webhookUrl,
    events: ['row.created', 'row.updated', 'row.deleted'],
    file_id: null
  }
});
console.log(`Webhook ${hook.id} → ${webhookUrl}`);

console.log('\nAdd these to deploy/prod.env (npm run secrets:pull first, then secrets:push):\n');
console.log(`REACT_DEMO_API_KEY=${apiKey}`);
console.log(`REACT_DEMO_WEBHOOK_SECRET=${hook.secret}`);
