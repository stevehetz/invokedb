// The support desk's server: one Node http handler, no framework.
//
//   <base>/api/<action>?table=...   the browser's InvokeDB calls (proxy.mjs says which), sent
//                                   on with the API key, rate-limited per IP
//   <base>/webhook                  InvokeDB's webhook deliveries, signature checked, turned
//                                   into feed items
//   <base>/events                   the feed, as server-sent events
//   <base>/health                   { ok, configured }
//   <base>/...                      the built React app (dist/), index.html for app routes
import fs from 'node:fs';
import path from 'node:path';
import { checkApiCall, MAX_BODY_BYTES, Refusal } from './proxy.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { verifySignature, SIGNATURE_HEADER } from './signature.mjs';
import { createHub, feedItems } from './events.mjs';

const MAX_WEBHOOK_BYTES = 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY'
};

function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...headers
  });
  res.end(JSON.stringify(data));
}

/** The raw body, or null once it passes `limit` bytes (the caller answers 413). */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      resolve(null);
      return;
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', chunk => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * @param {{
 *   basePath: string,
 *   db: ReturnType<typeof import('./invokedb.mjs').createInvokeDB> | null,
 *   webhookSecret: string,
 *   staticDir: string,
 *   trustProxy?: boolean,
 *   readLimit?: { perSecond: number, burst: number },
 *   writeLimit?: { perSecond: number, burst: number },
 *   now?: () => number,
 *   log?: (msg: string) => void
 * }} config
 */
export function createApp(config) {
  const {
    basePath,
    db,
    webhookSecret,
    staticDir,
    trustProxy = false,
    now = Date.now,
    log = msg => console.log(msg)
  } = config;
  const reads = createRateLimiter({ ...(config.readLimit || { perSecond: 5, burst: 30 }), now });
  const writes = createRateLimiter({
    ...(config.writeLimit || { perSecond: 0.5, burst: 10 }),
    now
  });
  const webhooks = createRateLimiter({ perSecond: 50, burst: 200, now });
  const sweep = setInterval(() => {
    reads.prune();
    writes.prune();
    webhooks.prune();
  }, 60_000);
  sweep.unref();

  const hub = createHub();
  // Delivery ids already handled: InvokeDB retries a delivery that wasn't answered in time
  const seen = new Set();
  // While the data is reset (and a little after, as its deliveries trickle in) the feed shows
  // one "reset" note instead of hundreds of rows
  let quietUntil = 0;
  let resetting = false;

  const clientIp = req => {
    if (trustProxy) {
      // Caddy sets X-Forwarded-For to the address it was connected from
      const fwd = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (fwd.length) return fwd[fwd.length - 1];
    }
    return req.socket.remoteAddress || 'unknown';
  };

  async function api(req, res, action, params) {
    const ip = clientIp(req);
    const isWrite = action === 'create' || action === 'update';
    const limit = (isWrite ? writes : reads).take(ip);
    if (!limit.ok) {
      return json(
        res,
        429,
        { message: 'Too many requests, slow down a little' },
        { 'Retry-After': String(limit.retryAfterSec) }
      );
    }
    if (!db) return json(res, 503, { message: 'The demo is not configured yet' });

    const raw = await readBody(req, MAX_BODY_BYTES);
    if (raw === null) return json(res, 413, { message: 'Request body too large' });
    let body;
    try {
      body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
    } catch {
      return json(res, 400, { message: 'The body must be JSON' });
    }

    let call;
    try {
      call = checkApiCall({ method: req.method, action, params, body });
    } catch (e) {
      if (e instanceof Refusal) return json(res, e.status, { message: e.message });
      throw e;
    }
    try {
      const out = await db.send(call.method, call.path, call.body);
      return json(res, out.status, out.data);
    } catch (e) {
      log(`InvokeDB call failed: ${e && e.message}`);
      return json(res, 502, { message: "Couldn't reach InvokeDB" });
    }
  }

  async function webhook(req, res) {
    if (req.method !== 'POST') return json(res, 405, { message: 'Use POST' });
    if (!webhooks.take(clientIp(req)).ok) return json(res, 429, { message: 'Too many requests' });
    const raw = await readBody(req, MAX_WEBHOOK_BYTES);
    if (raw === null) return json(res, 413, { message: 'Too large' });
    const ok = verifySignature(
      webhookSecret,
      raw,
      req.headers[SIGNATURE_HEADER],
      Math.floor(now() / 1000)
    );
    if (!ok) return json(res, 401, { message: 'Bad signature' });
    let payload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return json(res, 400, { message: 'Not JSON' });
    }
    const id = typeof payload.id === 'string' ? payload.id : '';
    if (id && seen.has(id)) return json(res, 200, { ok: true, duplicate: true });
    if (id) {
      seen.add(id);
      if (seen.size > 2000) seen.delete(seen.values().next().value);
    }
    if (!resetting && now() >= quietUntil) {
      for (const item of feedItems(payload)) hub.publish('change', item);
    }
    return json(res, 200, { ok: true });
  }

  function serveStatic(req, res, rest) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { message: 'Method not allowed' });
    }
    let rel;
    try {
      rel = decodeURIComponent(rest);
    } catch {
      return json(res, 400, { message: 'Bad path' });
    }
    const root = path.resolve(staticDir);
    let file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      return json(res, 404, { message: 'Not found' });
    }
    let stat = fs.statSync(file, { throwIfNoEntry: false });
    const isAsset = rel.startsWith('/assets/');
    if (!stat || !stat.isFile()) {
      // App routes (/tickets/..., /board) get the app; a missing asset is a 404
      if (isAsset || path.extname(rel)) return json(res, 404, { message: 'Not found' });
      file = path.join(root, 'index.html');
      stat = fs.statSync(file, { throwIfNoEntry: false });
      if (!stat) return json(res, 503, { message: 'The app has not been built' });
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const p = url.pathname;
    if (p === basePath) {
      res.writeHead(301, { Location: `${basePath}/${url.search}` });
      return res.end();
    }
    if (!p.startsWith(basePath + '/')) return json(res, 404, { message: 'Not found' });
    const rest = p.slice(basePath.length);

    if (rest.startsWith('/api/')) return api(req, res, rest.slice(5), url.searchParams);
    if (rest === '/webhook') return webhook(req, res);
    if (rest === '/events') {
      if (req.method !== 'GET') return json(res, 405, { message: 'Use GET' });
      return hub.add(req, res);
    }
    if (rest === '/health') return json(res, 200, { ok: true, configured: !!db });
    return serveStatic(req, res, rest);
  }

  return {
    async handler(req, res) {
      try {
        await handle(req, res);
      } catch (e) {
        log(`Request failed: ${e && e.stack}`);
        if (!res.headersSent) json(res, 500, { message: 'Something went wrong' });
        else res.end();
      }
    },
    hub,
    /** Runs `fn` (the reset) with the feed quiet, and tells the browsers to reload after. */
    async whileResetting(fn) {
      if (resetting) throw new Error('A reset is already running');
      resetting = true;
      hub.publish('reset', { state: 'started', at: new Date(now()).toISOString() });
      try {
        return await fn();
      } finally {
        resetting = false;
        // Webhook deliveries are sent every few seconds and retried: keep quiet a while
        quietUntil = now() + 60_000;
        hub.clearHistory();
        hub.publish('reset', { state: 'done', at: new Date(now()).toISOString() });
      }
    },
    close() {
      clearInterval(sweep);
      hub.close();
    }
  };
}
