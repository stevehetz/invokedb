// The server end to end on a random port, with a stand-in for InvokeDB: what reaches
// InvokeDB (and with which key), what the browser gets back, the webhook → SSE path.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.mjs';
import { createInvokeDB } from '../invokedb.mjs';
import { signatureHeader } from '../signature.mjs';

const KEY = 'inv_secret_key_for_tests';
const SECRET = 'whsec_test';

async function start(t, opts = {}) {
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body });
    return new Response(JSON.stringify({ data: [{ _id: 'r1', title: 'Hi' }], next_cursor: null }), {
      status: 200
    });
  };
  const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-demo-'));
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>desk</title>');
  fs.mkdirSync(path.join(staticDir, 'assets'));
  fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  const app = createApp({
    basePath: '/react-demo',
    db: createInvokeDB({ baseUrl: 'http://invokedb.test/api/v1', apiKey: KEY, fetch: fakeFetch }),
    webhookSecret: SECRET,
    staticDir,
    log: () => {},
    ...opts
  });
  const server = http.createServer(app.handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/react-demo`;
  t.after(() => {
    app.close();
    server.closeAllConnections();
    server.close();
    fs.rmSync(staticDir, { recursive: true, force: true });
  });
  return { base, sent, app };
}

const post = (url, body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });

test('forwards an allowed call with the server’s key and answers InvokeDB’s reply', async t => {
  const { base, sent } = await start(t);
  const res = await post(
    `${base}/api/query?table=Tickets&expand=customer`,
    { limit: 10 },
    {
      Authorization: 'Bearer something-from-the-browser'
    }
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.data[0].title, 'Hi');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'http://invokedb.test/api/v1/query?table=Tickets&expand=customer');
  assert.equal(sent[0].auth, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(sent[0].body), { limit: 10 });
  // The key never comes back to the browser
  assert.ok(!JSON.stringify(data).includes(KEY));
  assert.ok(![...res.headers.values()].some(v => v.includes(KEY)));
});

test('refuses calls outside the allowed list without calling InvokeDB', async t => {
  const { base, sent } = await start(t);
  assert.equal((await post(`${base}/api/delete?table=Tickets`, ['x'])).status, 404);
  assert.equal((await post(`${base}/api/query?table=Secrets`, {})).status, 403);
  assert.equal((await fetch(`${base}/api/query?table=Tickets`)).status, 405);
  assert.equal((await post(`${base}/api/query?table=Tickets`, '{nope')).status, 400);
  const big = { filters: [], cursor: 'x'.repeat(20_000) };
  assert.equal((await post(`${base}/api/query?table=Tickets`, big)).status, 413);
  assert.equal(sent.length, 0);
});

test('rate-limits per IP, writes more tightly than reads', async t => {
  const { base } = await start(t, {
    readLimit: { perSecond: 0.001, burst: 2 },
    writeLimit: { perSecond: 0.001, burst: 1 }
  });
  const q = () => post(`${base}/api/count?table=Tickets`, {});
  assert.equal((await q()).status, 200);
  assert.equal((await q()).status, 200);
  const limited = await q();
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  const comment = [
    { body: 'x', author: 'y', created: '2026-11-28T00:00:00Z', ticket: 'a'.repeat(24) }
  ];
  assert.equal((await post(`${base}/api/create?table=Comments`, comment)).status, 200);
  assert.equal((await post(`${base}/api/create?table=Comments`, comment)).status, 429);
});

test('answers 503 for API calls when no key is configured', async t => {
  const { base } = await start(t, { db: null });
  assert.equal((await post(`${base}/api/query?table=Tickets`, {})).status, 503);
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, configured: false });
});

async function readEvents(base, count) {
  const res = await fetch(`${base}/events`);
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader();
  const events = [];
  let buf = '';
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += Buffer.from(value).toString('utf8');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const type = /^event: (.*)$/m.exec(block);
      const data = /^data: (.*)$/m.exec(block);
      if (type && data) events.push({ type: type[1], data: JSON.parse(data[1]) });
    }
  }
  await reader.cancel();
  return events;
}

test('a signed webhook delivery reaches the browsers as a feed item', async t => {
  const { base } = await start(t);
  const listening = readEvents(base, 1);
  await new Promise(r => setTimeout(r, 50));
  const body = JSON.stringify({
    id: 'dlv_1',
    event: 'row.updated',
    created_at: '2026-11-28T10:00:00.000Z',
    table: { id: 3, name: 'Tickets' },
    rows: [{ _id: 'a'.repeat(24), number: 1001, title: 'Printer', status: 'closed' }]
  });
  const now = Math.floor(Date.now() / 1000);
  const res = await post(`${base}/webhook`, body, {
    'InvokeDB-Signature': signatureHeader(SECRET, body, now)
  });
  assert.equal(res.status, 200);
  const [event] = await listening;
  assert.equal(event.type, 'change');
  assert.equal(event.data.label, '#1001 Printer');
  assert.equal(event.data.detail, 'closed');
  assert.equal(event.data.table, 'Tickets');
  // A retry of the same delivery isn't shown twice
  const again = await post(`${base}/webhook`, body, {
    'InvokeDB-Signature': signatureHeader(SECRET, body, now)
  });
  assert.equal((await again.json()).duplicate, true);
});

test('refuses unsigned, wrongly signed and replayed deliveries', async t => {
  const { base } = await start(t);
  const body = JSON.stringify({ id: 'dlv_2', event: 'row.created', table: { name: 'Tickets' } });
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await post(`${base}/webhook`, body)).status, 401);
  const wrong = signatureHeader('whsec_wrong', body, now);
  assert.equal((await post(`${base}/webhook`, body, { 'InvokeDB-Signature': wrong })).status, 401);
  const old = signatureHeader(SECRET, body, now - 600);
  assert.equal((await post(`${base}/webhook`, body, { 'InvokeDB-Signature': old })).status, 401);
  const tampered = signatureHeader(SECRET, body, now);
  const res = await post(`${base}/webhook`, body.replace('created', 'deleted'), {
    'InvokeDB-Signature': tampered
  });
  assert.equal(res.status, 401);
});

test('serves the app, its assets and app routes, and nothing outside the build', async t => {
  const { base } = await start(t);
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /desk/);
  assert.equal((await fetch(`${base}/tickets/abc`)).status, 200);
  const asset = await fetch(`${base}/assets/app.js`);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  // ".." can't leave the build: the path is normalised inside it (and so gets the app)
  for (const p of ['/..%2f..%2fetc%2fpasswd', '/assets/..%2f..%2f..%2fetc%2fhosts']) {
    const text = await (await fetch(`${base}${p}`)).text();
    assert.ok(/desk|Not found/.test(text) && !/localhost|root:/.test(text), p);
  }
  const outside = await fetch(base.replace('/react-demo', '/other'));
  assert.equal(outside.status, 404);
  const bare = await fetch(base, { redirect: 'manual' });
  assert.equal(bare.status, 301);
});

test('limits open feeds and feed connects per address', async t => {
  const { base, app } = await start(t, {
    maxStreamsPerIp: 2,
    eventsLimit: { perSecond: 0.001, burst: 4 }
  });
  const open = [];
  for (let i = 0; i < 2; i++) {
    const res = await fetch(`${base}/events`);
    assert.equal(res.status, 200);
    open.push(res);
  }
  // A third stream from the same address is refused; the others stay open
  const third = await fetch(`${base}/events`);
  assert.equal(third.status, 429);
  await third.body?.cancel();
  assert.equal(app.hub.size(), 2);
  // Closing one frees its slot
  await open.pop().body.cancel();
  for (let i = 0; i < 50 && app.hub.size() > 1; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(app.hub.size(), 1);
  const again = await fetch(`${base}/events`);
  assert.equal(again.status, 200);
  open.push(again);
  // The connect bucket (4) is used up now: refused before the hub, with Retry-After
  const looped = await fetch(`${base}/events`);
  assert.equal(looped.status, 429);
  assert.ok(Number(looped.headers.get('retry-after')) >= 1);
  await looped.body?.cancel();
  for (const res of open) await res.body.cancel();
});
