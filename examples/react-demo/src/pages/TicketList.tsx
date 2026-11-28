// Tickets with filters and search: POST /api/v1/query with filters, a sort and cursor paging,
// and expand=customer for the linked customer's name.
import { useCallback, useEffect, useState } from 'react';
import {
  countTickets,
  errorMessage,
  listTickets,
  PRIORITIES,
  STATUSES,
  STATUS_LABELS,
  ticketCustomer,
  type Ticket,
  type TicketFilters
} from '../api';
import { useLiveChanges } from '../live';
import { Link } from '../router';
import { ErrorNote, formatDate, PriorityBadge, StatusBadge, useCustomers } from '../ui';

export function TicketList() {
  const customers = useCustomers();
  const [filters, setFilters] = useState<TicketFilters>({});
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Ticket[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped to read the first page again (a change in the live feed)
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(v => v + 1), []);

  // The search box waits for a pause in typing
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => ({ ...f, search })), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let live = true;
    Promise.all([listTickets(filters), countTickets(filters)]).then(
      ([page, total]) => {
        if (!live) return;
        setRows(page.data);
        setCursor(page.next_cursor);
        setCount(total);
        setError(null);
        setLoaded(true);
      },
      e => live && setError(errorMessage(e))
    );
    return () => {
      live = false;
    };
  }, [filters, version]);

  useLiveChanges(['Tickets', 'Customers'], reload);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await listTickets(filters, cursor);
      setRows(r => [...r, ...page.data]);
      setCursor(page.next_cursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const set = (patch: Partial<TicketFilters>) => setFilters(f => ({ ...f, ...patch }));

  return (
    <section>
      <div className="page-head">
        <h1>Tickets</h1>
        <Link to="new" className="button primary">
          New ticket
        </Link>
      </div>
      <div className="filters">
        <input
          type="search"
          placeholder="Search titles…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search titles"
        />
        <select
          value={filters.status || ''}
          onChange={e => set({ status: e.target.value as TicketFilters['status'] })}
          aria-label="Status"
        >
          <option value="">Any status</option>
          {STATUSES.map(s => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={filters.priority || ''}
          onChange={e => set({ priority: e.target.value as TicketFilters['priority'] })}
          aria-label="Priority"
        >
          <option value="">Any priority</option>
          {PRIORITIES.map(p => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={filters.customer || ''}
          onChange={e => set({ customer: e.target.value })}
          aria-label="Customer"
        >
          <option value="">Any customer</option>
          {customers.map(c => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        {count !== null && <span className="muted">{count} tickets</span>}
      </div>
      <ErrorNote error={error} />
      <table className="tickets">
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(t => (
            <tr key={t._id}>
              <td className="muted">{t.number}</td>
              <td>
                <Link to={`tickets/${t._id}`}>{t.title}</Link>
              </td>
              <td>{ticketCustomer(t)?.name || <span className="muted">none</span>}</td>
              <td>
                <StatusBadge status={t.status} />
              </td>
              <td>
                <PriorityBadge priority={t.priority} />
              </td>
              <td className="muted">{formatDate(t.created)}</td>
            </tr>
          ))}
          {loaded && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted center">
                No tickets match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {cursor && (
        <button className="button" onClick={loadMore} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
