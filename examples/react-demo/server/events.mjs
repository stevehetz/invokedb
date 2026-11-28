// The live activity feed: turns InvokeDB webhook deliveries into short feed items and sends
// them to every open browser over server-sent events (GET /events).
import { TABLE_NAMES } from './schema.mjs';

const MAX_ITEMS_PER_DELIVERY = 10;

const clip = (value, max) => {
  if (value === null || value === undefined) return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function label(table, row) {
  if (table === 'Tickets') {
    const n = typeof row.number === 'number' ? `#${row.number} ` : '';
    return clip(`${n}${row.title ?? ''}`, 100);
  }
  if (table === 'Comments') return clip(`${row.author ?? 'Someone'}: ${row.body ?? ''}`, 100);
  return clip(row.name ?? row.email ?? '', 100);
}

function detail(table, row) {
  if (table === 'Tickets' && row.status) {
    return clip([row.status, row.priority].filter(Boolean).join(' · '), 40);
  }
  return '';
}

/**
 * Feed items for one delivery, or [] for events this app doesn't show (pings, other tables).
 * Text comes from whoever edited the row, so it is clipped here and rendered as text only.
 *
 * @param {any} payload the delivery's JSON body
 * @returns {Array<{ id: string, at: string, event: string, table: string, rowId: string,
 *   label: string, detail: string }>}
 */
export function feedItems(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const event = payload.event;
  if (!['row.created', 'row.updated', 'row.deleted'].includes(event)) return [];
  const table = payload.table && payload.table.name;
  const name = TABLE_NAMES.find(n => n.toLowerCase() === String(table).toLowerCase());
  if (!name || !Array.isArray(payload.rows)) return [];
  const at = typeof payload.created_at === 'string' ? payload.created_at : new Date().toISOString();
  const rows = payload.rows.filter(r => r && typeof r._id === 'string');
  const items = rows.slice(0, MAX_ITEMS_PER_DELIVERY).map((row, i) => ({
    id: `${clip(payload.id, 60)}:${i}`,
    at,
    event,
    table: name,
    rowId: clip(row._id, 24),
    label: event === 'row.deleted' ? '' : label(name, row),
    detail: event === 'row.deleted' ? '' : detail(name, row)
  }));
  if (rows.length > MAX_ITEMS_PER_DELIVERY) {
    items.push({
      id: `${clip(payload.id, 60)}:more`,
      at,
      event,
      table: name,
      rowId: '',
      label: `and ${rows.length - MAX_ITEMS_PER_DELIVERY} more rows`,
      detail: ''
    });
  }
  return items;
}

/**
 * The browsers listening on /events. Each gets the last `historySize` items when it connects,
 * then every new one; a comment line every `heartbeatMs` keeps proxies from closing the stream.
 */
export function createHub({ maxClients = 500, historySize = 30, heartbeatMs = 25_000 } = {}) {
  /** @type {Set<import('node:http').ServerResponse>} */
  const clients = new Set();
  /** @type {Array<{ type: string, data: unknown }>} */
  const history = [];
  let seq = 0;

  const frame = (type, data) => `id: ${++seq}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

  const timer = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, heartbeatMs);
  timer.unref();

  return {
    /** @param {import('node:http').IncomingMessage} req @param {import('node:http').ServerResponse} res */
    add(req, res) {
      if (clients.size >= maxClients) {
        res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '30' });
        res.end(JSON.stringify({ message: 'Too many listeners, try again soon' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 3000\n\n');
      for (const h of history) res.write(frame(h.type, h.data));
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    /** Sends an event (`change` for feed items, `reset` around a data reset) to everyone. */
    publish(type, data) {
      if (type === 'change') {
        history.push({ type, data });
        if (history.length > historySize) history.shift();
      }
      const text = frame(type, data);
      for (const res of clients) res.write(text);
    },
    clearHistory() {
      history.length = 0;
    },
    size: () => clients.size,
    close() {
      clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
    }
  };
}
