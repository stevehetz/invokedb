import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { API_KEY } from 'src/invoke-config.json';
import { IGetParams } from './invokedb.params';

const BASE_URL = 'http://localhost:8001/api/v1';

@Injectable({
  providedIn: 'root'
})
export class InvokedbService {
  constructor(private http: HttpClient) {}

  getHeaders() {
    return new HttpHeaders().set('Authorization', `Bearer ${API_KEY}`);
  }

  get(table: string, params: IGetParams, filter?: any) {
    const { skip, limit, sort } = params;

    let urlQuery = `table=${table}`;
    urlQuery += `&skip=${skip}`;
    urlQuery += `&limit=${limit}`;

    if (sort) {
      urlQuery += `&sort_by=${sort.sortBy}`;
      urlQuery += `&sort_dir=${sort.sortDir}`;
    }

    const headers = this.getHeaders();

    return filter
      ? this.http.post(`${BASE_URL}/search?${urlQuery}`, filter, { headers })
      : this.http.get(`${BASE_URL}/get?${urlQuery}`, { headers });
  }

  update(table: string, data: any) {
    const headers = this.getHeaders();
    const urlQuery = `table=${table}`;
    const url = `${BASE_URL}/update?${urlQuery}`;
    return this.http.put(url, data, { headers });
  }

  delete(table: string, data: any) {
    const headers = this.getHeaders();
    const urlQuery = `table=${table}`;
    const url = `${BASE_URL}/delete?${urlQuery}`;
    return this.http.post(url, data, { headers });
  }

  create(table: string, data: any) {
    const headers = this.getHeaders();
    const urlQuery = `table=${table}`;
    const url = `${BASE_URL}/create?${urlQuery}`;
    return this.http.post(url, data, { headers });
  }
}
