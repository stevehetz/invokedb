// Every InvokeDB call the app makes. They go to this app's own server (server/app.mjs), which
// adds the API key and sends them on to InvokeDB's /api/v1, so the browser never holds a key.
// The `invokedb` client (examples/invokedb-node) works unchanged against it: its base URL is
// the server's /api, and the key it sends is a placeholder the server ignores.
import { InvokeDBClient, InvokeDBError, type IQueryFilter } from 'invokedb';

export const BASE = import.meta.env.BASE_URL; // "/react-demo/"
const API = `${BASE}api`;

const db = new InvokeDBClient({ baseUrl: API, apiKey: 'held-by-the-server' });
const customers = db.table('Customers');
const tickets = db.table('Tickets');
const comments = db.table('Comments');

export const STATUSES = ['open', 'in_progress', 'waiting', 'closed'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Status = (typeof STATUSES)[number];
export type Priority = (typeof PRIORITIES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting on customer',
  closed: 'Closed'
};

export interface Customer {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  city?: string;
  state?: string;
}

export interface Ticket {
  _id: string;
  number: number;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  created: string;
  // With expand=customer: the linked rows; without, their ids
  customer: Array<Customer | string> | null;
}

export interface Comment {
  _id: string;
  body: string;
  author: string;
  created: string;
  ticket: string[] | null;
}

export interface TicketFilters {
  status?: Status | '';
  priority?: Priority | '';
  customer?: string;
  search?: string;
}

export { InvokeDBError };

/** The linked customer of an expanded ticket, if any. */
export function ticketCustomer(t: Ticket): Customer | null {
  const c = t.customer && t.customer[0];
  return c && typeof c === 'object' ? c : null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof InvokeDBError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

function ticketFilters(f: TicketFilters): IQueryFilter[] {
  const filters: IQueryFilter[] = [];
  if (f.status) filters.push({ column: 'status', op: 'eq', value: f.status });
  if (f.priority) filters.push({ column: 'priority', op: 'eq', value: f.priority });
  // A link cell holds row ids, so "eq <id>" finds the rows linking to it
  if (f.customer) filters.push({ column: 'customer', op: 'eq', value: f.customer });
  if (f.search && f.search.trim()) {
    filters.push({ column: 'title', op: 'contains', value: f.search.trim() });
  }
  return filters;
}

// The client has no `expand` option yet, so the one call that needs it is made here
async function queryExpanded<T>(table: string, expand: string, body: object) {
  const res = await fetch(
    `${API}/query?table=${encodeURIComponent(table)}&expand=${encodeURIComponent(expand)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new InvokeDBError(data?.message || `Request failed (${res.status})`, res.status, data);
  }
  return data as { data: T[]; next_cursor: string | null };
}

/** A page of tickets, newest first, with their customers. Pass next_cursor for the next one. */
export function listTickets(filters: TicketFilters, cursor: string | null = null, limit = 25) {
  return queryExpanded<Ticket>('Tickets', 'customer', {
    filters: ticketFilters(filters),
    sort: [{ column: 'created', dir: 'desc' }],
    limit,
    cursor
  });
}

export function countTickets(filters: TicketFilters) {
  return tickets.count({ filters: ticketFilters(filters) });
}

/** The board's cards: the newest 50 of each status. */
export async function boardTickets(): Promise<Record<Status, Ticket[]>> {
  const pages = await Promise.all(STATUSES.map(status => listTickets({ status }, null, 50)));
  return Object.fromEntries(STATUSES.map((s, i) => [s, pages[i].data])) as Record<Status, Ticket[]>;
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const res = await queryExpanded<Ticket>('Tickets', 'customer', {
    filters: [{ column: '_id', op: 'eq', value: id }],
    limit: 1
  });
  return res.data[0] || null;
}

export async function updateTicket(
  id: string,
  changes: Partial<Pick<Ticket, 'status' | 'priority'>>
) {
  await tickets.update({ _id: id, ...changes });
}

/** Makes a ticket and answers its id (create answers nothing, so it's found by its number). */
export async function createTicket(input: {
  title: string;
  description: string;
  priority: Priority;
  customer: string;
}): Promise<string | null> {
  const last = await tickets.query<{ number: number }>({
    sort: [{ column: 'number', dir: 'desc' }],
    fields: ['number'],
    limit: 1
  });
  const number = (last.data[0]?.number || 1000) + 1;
  await tickets.insert({
    number,
    title: input.title,
    description: input.description,
    status: 'open',
    priority: input.priority,
    created: new Date().toISOString(),
    customer: [input.customer]
  });
  const made = await tickets.query<{ _id: string }>({
    filters: [{ column: 'number', op: 'eq', value: number }],
    fields: ['number'],
    sort: [{ column: 'created', dir: 'desc' }],
    limit: 1
  });
  return made.data[0]?._id || null;
}

export async function listComments(ticketId: string) {
  const res = await comments.query<Comment>({
    filters: [{ column: 'ticket', op: 'eq', value: ticketId }],
    sort: [{ column: 'created', dir: 'asc' }],
    limit: 100
  });
  return res.data;
}

export async function addComment(ticketId: string, author: string, body: string) {
  await comments.insert({
    body,
    author,
    created: new Date().toISOString(),
    ticket: [ticketId]
  });
}

export async function listCustomers() {
  const res = await customers.query<Customer>({
    sort: [{ column: 'name', dir: 'asc' }],
    fields: ['name', 'email'],
    limit: 100
  });
  return res.data;
}
