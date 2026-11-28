// What the browser may ask of InvokeDB through this server. The server holds the API key, so
// it only forwards the calls this app makes, on its three tables, with bodies it has checked:
// anything else is refused before it reaches InvokeDB. InvokeDB checks everything again
// (column names, types, links); these rules keep the demo's data to what the app can make.
import { PRIORITIES, STATUSES } from './schema.mjs';

export const MAX_BODY_BYTES = 16 * 1024;
const MAX_PAGE = 100;
const MAX_FILTERS = 10;

const ROW_ID = /^[0-9a-f]{24}$/i;

class Refusal extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const refuse = (message, status = 400) => {
  throw new Refusal(status, message);
};

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- field rules ----

const text =
  (max, required = false) =>
  (value, name) => {
    if (value === undefined || value === null) {
      if (required) refuse(`${name} is required`);
      return null;
    }
    if (typeof value !== 'string') refuse(`${name} must be text`);
    const trimmed = value.trim();
    if (required && trimmed === '') refuse(`${name} is required`);
    if (trimmed.length > max) refuse(`${name} can be at most ${max} characters`);
    return trimmed;
  };

const oneOf = list => (value, name) => {
  if (!list.includes(value)) refuse(`${name} must be one of ${list.join(', ')}`);
  return value;
};

const positiveInt = (value, name) => {
  if (!Number.isInteger(value) || value < 1 || value > 10_000_000) {
    refuse(`${name} must be a whole number`);
  }
  return value;
};

const isoDate = (value, name) => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    refuse(`${name} must be an ISO date (2026-01-31T12:00:00Z)`);
  }
  return value;
};

const link =
  (required = false) =>
  (value, name) => {
    if (value === undefined || value === null || (Array.isArray(value) && !value.length)) {
      if (required) refuse(`${name} is required`);
      return null;
    }
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length !== 1 || typeof ids[0] !== 'string' || !ROW_ID.test(ids[0])) {
      refuse(`${name} must be one row _id`);
    }
    return [ids[0].toLowerCase()];
  };

// ---- the allowed calls ----

/**
 * @typedef {(value: unknown, name: string) => unknown} Rule
 * @typedef {{ fields: Record<string, Rule>, required?: string[] }} RowRules
 * @typedef {{ query?: { expand: string[] }, count?: boolean, create?: RowRules,
 *   update?: RowRules }} TableRules
 */

/** @type {Record<string, TableRules>} */
export const ALLOWED = {
  // Read-only: the app picks customers, it doesn't make them
  Customers: { query: { expand: [] }, count: true },
  Tickets: {
    query: { expand: ['customer'] },
    count: true,
    create: {
      fields: {
        number: positiveInt,
        title: text(120, true),
        description: text(2000),
        status: oneOf(STATUSES),
        priority: oneOf(PRIORITIES),
        created: isoDate,
        customer: link(true)
      },
      required: ['number', 'title', 'status', 'priority', 'created', 'customer']
    },
    // Status and priority from the board and the ticket page, title/description from edits
    update: {
      fields: {
        title: text(120, true),
        description: text(2000),
        status: oneOf(STATUSES),
        priority: oneOf(PRIORITIES)
      }
    }
  },
  Comments: {
    query: { expand: [] },
    count: true,
    create: {
      fields: {
        body: text(1000, true),
        author: text(60, true),
        created: isoDate,
        ticket: link(true)
      },
      required: ['body', 'author', 'created', 'ticket']
    }
  }
};

const ACTIONS = { query: 'POST', count: 'POST', create: 'POST', update: 'PUT' };

/** Checks a query body's shape and size; InvokeDB checks the columns and values. */
function checkQuery(body, isCount) {
  if (!isPlainObject(body)) refuse('The body must be a JSON object');
  const allowed = isCount
    ? ['filters', 'match']
    : ['filters', 'match', 'sort', 'fields', 'limit', 'cursor'];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) refuse(`${key} isn't allowed here`);
  }
  if (body.filters !== undefined) {
    if (!Array.isArray(body.filters) || body.filters.length > MAX_FILTERS) {
      refuse(`filters must be a list of at most ${MAX_FILTERS}`);
    }
  }
  if (body.limit !== undefined) {
    if (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > MAX_PAGE) {
      refuse(`limit must be 1 to ${MAX_PAGE}`);
    }
  }
  return body;
}

/** One row checked against the table's rules: only its fields, each checked. */
function checkRow(row, rules, isUpdate) {
  if (!isPlainObject(row)) refuse('Each row must be a JSON object');
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (isUpdate && key === '_id') {
      if (typeof value !== 'string' || !ROW_ID.test(value)) refuse('_id must be a row id');
      out._id = value;
      continue;
    }
    const rule = rules.fields[key];
    if (!rule) refuse(`${key} can't be ${isUpdate ? 'changed' : 'set'} from this app`);
    out[key] = rule(value, key);
  }
  for (const key of rules.required || []) {
    if (out[key] === undefined || out[key] === null) refuse(`${key} is required`);
  }
  if (isUpdate) {
    if (!out._id) refuse('_id is required');
    if (Object.keys(out).length < 2) refuse('Nothing to change');
  }
  return out;
}

/**
 * Checks one call from the browser. `action` is the last part of /api/<action>; `params` its
 * query string. Answers the InvokeDB path and the body to send, or throws a Refusal (status,
 * message) that the server answers as it is.
 *
 * @param {{ method: string, action: string, params: URLSearchParams, body: unknown }} call
 * @returns {{ path: string, method: string, body: unknown }}
 */
export function checkApiCall({ method, action, params, body }) {
  const expected = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!expected) refuse('Not found', 404);
  if (method !== expected) refuse(`Use ${expected} for ${action}`, 405);

  for (const key of params.keys()) {
    if (key !== 'table' && key !== 'expand') refuse(`The ${key} parameter isn't allowed`);
  }
  if (params.getAll('table').length !== 1) refuse('One table parameter is required');
  const table = params.get('table');
  if (!Object.hasOwn(ALLOWED, table))
    refuse('This app only uses the Customers, Tickets and Comments tables', 403);
  const rules = ALLOWED[table];
  const rule = rules[action];
  if (!rule) refuse(`${action} isn't allowed on ${table}`, 403);

  const query = new URLSearchParams({ table });
  const expand = params.getAll('expand');
  if (expand.length) {
    if (action !== 'query' || expand.length !== 1 || !rules.query.expand.includes(expand[0])) {
      refuse(`expand isn't allowed here`, 403);
    }
    query.set('expand', expand[0]);
  }

  let checked;
  if (action === 'query' || action === 'count') {
    checked = checkQuery(body, action === 'count');
  } else {
    // One row at a time: the app never writes more
    if (!Array.isArray(body) || body.length !== 1) refuse('Send one row at a time');
    checked = [checkRow(body[0], rule, action === 'update')];
  }
  return { path: `/${action}?${query}`, method: expected, body: checked };
}

export { Refusal };
