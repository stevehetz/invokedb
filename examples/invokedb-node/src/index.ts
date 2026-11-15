import axios from 'axios';

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

const DEFAULT_LIMIT = 10;
const DEFAULT_SORT_DIR = 'asc';

class InvokeDBFind {
  private _skip: number;
  private _limit: number;
  private _sortBy: string;
  private _sortDir: string;

  constructor(private _baseUrl: string, private _apiKey: string, private _tableName: string, private _filter?: any, private _findOne: boolean = false) { }

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

  async count() {
    const res = await this.exec();
    return res.count;
  }

  async exec() {
    const headers = { Authorization: `Bearer ${this._apiKey}` };
    
    this._limit = typeof this._limit === 'number' ? this._limit : DEFAULT_LIMIT;

    let urlQuery = `table=${this._tableName}`;
    urlQuery += `&skip=${this._skip || 0}`;
    urlQuery += `&limit=${this._limit}`;

    if (this._sortBy) {
      urlQuery += `&sort_by=${this._sortBy}`;
      urlQuery += `&sort_dir=${this._sortDir || DEFAULT_SORT_DIR}`;
    }

    const res = this._filter
      ? await axios.post(`${this._baseUrl}/search?${urlQuery}`, this._filter, { headers })
      : await axios.get(`${this._baseUrl}/get?${urlQuery}`, { headers });

    if (res && res.data) {
      if (this._findOne) {
        return Array.isArray(res.data.data) && res.data.data[0]
          ? res.data.data[0]
          : null;
      }
      return res.data;
    } else {
      return {
        count: 0,
        data: []
      }
    }
  }
}


export class InvokeDBTable {
  constructor(private _baseUrl: string, private _apiKey: string, private _tableName: string) { }
  
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
    this.validateInsert(data);
    if (!Array.isArray(data) && Object.keys(data).length > 0) {
      data = [data];
    }
    const headers = { Authorization: `Bearer ${this._apiKey}` };
    const url = `${this._baseUrl}/create?table=${this._tableName}`;
    return await axios.post(url, data, { headers });
  }

  private validateInsert(data: any) {
    if (typeof data === 'number' || typeof data === 'string' || typeof data === 'boolean' || data === null || data === undefined) {
      throw 'Insert payload must be an object or an array';
    }
  }

  async update(data: any) {
     this.validateUpdate(data);
     if (!Array.isArray(data) && Object.keys(data).length > 0) {
       data = [data];
     }
     const headers = { Authorization: `Bearer ${this._apiKey}` };
     const url = `${this._baseUrl}/update?table=${this._tableName}`;
     return await axios.put(url, data, { headers });
  }

  private validateUpdate(data: any) {
    if (typeof data === 'number' || typeof data === 'string' || typeof data === 'boolean' || data === null || data === undefined) {
      throw 'Update payload must be an object or an array';
    }
  }
  

  async delete(data: string | Array<string>) {
    if (typeof data === 'string') {
      data = [data]
    }
    if (Array.isArray(data)) {
      const headers = { Authorization: `Bearer ${this._apiKey}` };
      const url = `${this._baseUrl}/delete?table=${this._tableName}`;
      return await axios.post(url, data, { headers });
    }

    return null;
  }
}

export class InvokeDBClient {
  private _baseUrl: string;
  private _apiKey: string;
  
  constructor(private _config: IClientConfig) {
    const { baseUrl, apiKey } = this._config;
    if (!apiKey && typeof apiKey !== 'string') {
      throw 'Must provide a valid api key';
    }
    this._baseUrl = baseUrl || 'https://api.invokedb.com/v1';
    this._apiKey = apiKey;
  }

  table(tableName: string) {
    return new InvokeDBTable(this._baseUrl, this._apiKey, tableName);
  }
}
