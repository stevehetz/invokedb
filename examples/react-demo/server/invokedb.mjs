// The server's calls to InvokeDB's /api/v1 with the demo account's API key. The key stays
// here: the browser only ever talks to this server.

export class InvokeDBError extends Error {
  /** @param {string} message @param {number} status @param {unknown} body */
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * @param {{ baseUrl: string, apiKey: string, fetch?: typeof fetch, timeoutMs?: number }} opts
 */
export function createInvokeDB({ baseUrl, apiKey, fetch: doFetch = fetch, timeoutMs = 15000 }) {
  const base = baseUrl.replace(/\/+$/, '');

  /**
   * One call; answers `{ status, data }` whatever the status (the proxy passes it on).
   * @param {string} method @param {string} path such as `/query?table=Tickets` @param {unknown} [body]
   */
  async function send(method, path, body) {
    const res = await doFetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text.slice(0, 200) };
    }
    return { status: res.status, data };
  }

  /** Like send, but throws unless it's a 2xx. */
  async function call(method, path, body) {
    const res = await send(method, path, body);
    if (res.status < 200 || res.status > 299) {
      const message = (res.data && res.data.message) || `HTTP ${res.status}`;
      throw new InvokeDBError(`${method} ${path}: ${message}`, res.status, res.data);
    }
    return res.data;
  }

  const t = table => `table=${encodeURIComponent(table)}`;

  return {
    send,
    call,
    /** Every row matching `query`, page by page (cursor paging). */
    async queryAll(table, query = {}) {
      const rows = [];
      let cursor = null;
      do {
        const page = await call('POST', `/query?${t(table)}`, { ...query, limit: 100, cursor });
        rows.push(...page.data);
        cursor = page.next_cursor;
      } while (cursor);
      return rows;
    },
    async create(table, rows) {
      for (let i = 0; i < rows.length; i += 100) {
        await call('POST', `/create?${t(table)}`, rows.slice(i, i + 100));
      }
    },
    /** Deletes every row of the table, 100 at a time. */
    async deleteAll(table) {
      for (let round = 0; round < 1000; round++) {
        const page = await call('POST', `/query?${t(table)}`, { limit: 100 });
        if (!page.data.length) return;
        await call(
          'POST',
          `/delete?${t(table)}`,
          page.data.map(r => r._id)
        );
      }
      throw new Error(`${table}: rows kept coming back while deleting`);
    }
  };
}
