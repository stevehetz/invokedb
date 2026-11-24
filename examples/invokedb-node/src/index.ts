// InvokeDB JavaScript client. Uses the built-in fetch (Node 18+ and every current browser),
// so it has no runtime dependencies.

export enum SORT_DIR {
  ASC = 'asc',
  DESC = 'desc'
}

export interface ISortParam {
  sortBy: string;
  sortDir: SORT_DIR;
}

export interface IClientConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface IFindResult<T = any> {
  count: number;
  data: Array<T & { _id: string }>;
}

// There is no public API for now, so the default is the local dev backend.
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8001/api/v1';
const DEFAULT_LIMIT = 10;
const DEFAULT_SORT_DIR = 'asc';

// Drops trailing slashes in one linear pass. A /\/+$/ regex backtracks on
// every run of slashes that isn't at the end: quadratic in the run's length.
function trimTrailingSlashes(url: string) {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47 /* '/' */) {
    end--;
  }
  return url.slice(0, end);
}

export class InvokeDBError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: any
  ) {
    super(message);
    this.name = 'InvokeDBError';
  }
}

async function request(
  apiKey: string,
  method: string,
  url: string,
  body?: any
): Promise<any> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    // not JSON: keep the text
  }

  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && data.message) ||
      `InvokeDB request failed with status ${res.status}`;
    throw new InvokeDBError(message, res.status, data);
  }
  return data;
}

function tableUrl(baseUrl: string, action: string, tableName: string) {
  return `${baseUrl}/${action}?table=${encodeURIComponent(tableName)}`;
}

function assertPayload(data: any, action: string) {
  if (data === null || typeof data !== 'object') {
    throw new TypeError(`${action} payload must be an object or an array`);
  }
}

class InvokeDBFind {
  private _skip = 0;
  private _limit = DEFAULT_LIMIT;
  private _sortBy: string | undefined;
  private _sortDir: string | undefined;

  constructor(
    private _baseUrl: string,
    private _apiKey: string,
    private _tableName: string,
    private _filter?: any,
    private _findOne: boolean = false
  ) {}

  limit(value: number) {
    this._limit = value;
    return this;
  }

  skip(value: number) {
    this._skip = value;
    return this;
  }

  sortBy(value: string) {
    this._sortBy = value;
    return this;
  }

  sortDir(value: string) {
    this._sortDir = value;
    return this;
  }

  async count(): Promise<number> {
    const res = await this.run();
    return res.count;
  }

  async exec(): Promise<any> {
    const res = await this.run();
    if (this._findOne) {
      return res.data[0] || null;
    }
    return res;
  }

  private async run(): Promise<IFindResult> {
    let query = `skip=${this._skip}&limit=${this._limit}`;
    if (this._sortBy) {
      query += `&sort_by=${encodeURIComponent(this._sortBy)}`;
      query += `&sort_dir=${this._sortDir || DEFAULT_SORT_DIR}`;
    }

    const res = this._filter
      ? await request(
          this._apiKey,
          'POST',
          `${tableUrl(this._baseUrl, 'search', this._tableName)}&${query}`,
          this._filter
        )
      : await request(
          this._apiKey,
          'GET',
          `${tableUrl(this._baseUrl, 'get', this._tableName)}&${query}`
        );

    return res && Array.isArray(res.data) ? res : { count: 0, data: [] };
  }
}

export class InvokeDBTable {
  constructor(
    private _baseUrl: string,
    private _apiKey: string,
    private _tableName: string
  ) {}

  private _createFindClient(filter?: any, findOne = false) {
    return new InvokeDBFind(
      this._baseUrl,
      this._apiKey,
      this._tableName,
      filter,
      findOne
    );
  }

  count() {
    return this._createFindClient().count();
  }

  find(filter?: any) {
    return this._createFindClient(filter);
  }

  findOne(filter?: any) {
    return this._createFindClient(filter, true);
  }

  async insert(data: any) {
    assertPayload(data, 'Insert');
    const rows = Array.isArray(data) ? data : [data];
    const url = tableUrl(this._baseUrl, 'create', this._tableName);
    return await request(this._apiKey, 'POST', url, rows);
  }

  async update(data: any) {
    assertPayload(data, 'Update');
    const rows = Array.isArray(data) ? data : [data];
    const url = tableUrl(this._baseUrl, 'update', this._tableName);
    return await request(this._apiKey, 'PUT', url, rows);
  }

  async delete(ids: string | Array<string>) {
    const list = typeof ids === 'string' ? [ids] : ids;
    if (!Array.isArray(list)) {
      throw new TypeError('Delete takes an _id or an array of _ids');
    }
    const url = tableUrl(this._baseUrl, 'delete', this._tableName);
    return await request(this._apiKey, 'POST', url, list);
  }
}

export class InvokeDBClient {
  private _baseUrl: string;
  private _apiKey: string;

  constructor(config: IClientConfig) {
    const { baseUrl, apiKey } = config || ({} as IClientConfig);
    if (!apiKey || typeof apiKey !== 'string') {
      throw new TypeError('Must provide a valid api key');
    }
    this._baseUrl = trimTrailingSlashes(baseUrl || DEFAULT_BASE_URL);
    this._apiKey = apiKey;
  }

  table(tableName: string) {
    return new InvokeDBTable(this._baseUrl, this._apiKey, tableName);
  }
}
