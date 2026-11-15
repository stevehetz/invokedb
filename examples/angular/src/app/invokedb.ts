import { Injectable } from '@angular/core';
import { InvokeDBClient, InvokeDBError, InvokeDBTable } from 'invokedb';

export interface InvokeDBConfig {
  apiKey: string;
  baseUrl?: string;
}

const CONFIG_URL = 'invokedb.config.json';

class ConfigMissingError extends Error {}

/**
 * Gives pages an InvokeDB table. The API key is read at runtime from
 * public/invokedb.config.json, which `node examples/setup.mjs` writes.
 */
@Injectable({ providedIn: 'root' })
export class InvokeDB {
  private client?: Promise<InvokeDBClient>;
  baseUrl = '';

  async table(name: string): Promise<InvokeDBTable> {
    this.client ??= this.loadClient();
    try {
      return (await this.client).table(name);
    } catch (e) {
      this.client = undefined; // try the config again next time
      throw e;
    }
  }

  private async loadClient() {
    const res = await fetch(CONFIG_URL, { cache: 'no-store' });
    const config: InvokeDBConfig | null = res.ok ? await res.json().catch(() => null) : null;
    if (!config?.apiKey) {
      throw new ConfigMissingError();
    }
    this.baseUrl = config.baseUrl || '';
    return new InvokeDBClient(config);
  }

  /** A message for the user explaining what went wrong and how to fix it. */
  describeError(e: unknown, table: string): string {
    if (e instanceof ConfigMissingError) {
      return 'No API key yet. From the repo root, start the app (npm run dev), then run: node examples/setup.mjs';
    }
    if (e instanceof InvokeDBError) {
      if (e.status === 400 && /not found/i.test(e.message)) {
        return `Table "${table}" doesn't exist. Run: node examples/setup.mjs`;
      }
      if (e.status === 401) {
        return 'The API key was rejected. Run node examples/setup.mjs again to refresh it.';
      }
      return `InvokeDB error (${e.status}): ${e.message}`;
    }
    if (e instanceof TypeError) {
      return `Can't reach the InvokeDB backend${this.baseUrl ? ` at ${this.baseUrl}` : ''}. Is npm run dev running?`;
    }
    return e instanceof Error ? e.message : String(e);
  }
}

/** The API returns dates as "YYYY-MM-DD hh:mm:ss AM"; forms and display want "YYYY-MM-DD". */
export function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}
