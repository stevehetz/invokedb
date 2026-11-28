// One ticket: its details, the linked customer (expand=customer), its comments (a query on the
// Comments table's link column), a form to add one, and status/priority changes.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  addComment,
  errorMessage,
  getTicket,
  listComments,
  PRIORITIES,
  STATUSES,
  STATUS_LABELS,
  ticketCustomer,
  updateTicket,
  type Comment,
  type Priority,
  type Status,
  type Ticket
} from '../api';
import { useLiveChanges } from '../live';
import { Link } from '../router';
import { ErrorNote, formatDate, PriorityBadge, StatusBadge } from '../ui';

const AUTHOR_KEY = 'react-demo:author';

export function TicketPage({ id }: { id: string }) {
  const [ticket, setTicket] = useState<Ticket | null | undefined>(undefined);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [author, setAuthor] = useState(() => localStorage.getItem(AUTHOR_KEY) || '');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  // Bumped to read the ticket again (a change in the live feed)
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let live = true;
    Promise.all([getTicket(id), listComments(id)]).then(
      ([t, c]) => {
        if (!live) return;
        setTicket(t);
        setComments(c);
        setError(null);
      },
      e => live && setError(errorMessage(e))
    );
    return () => {
      live = false;
    };
  }, [id, version]);
  useLiveChanges(['Tickets', 'Comments', 'Customers'], reload);

  async function change(changes: { status?: Status; priority?: Priority }) {
    if (!ticket) return;
    const before = ticket;
    setTicket({ ...ticket, ...changes });
    try {
      await updateTicket(ticket._id, changes);
    } catch (e) {
      setTicket(before);
      setError(errorMessage(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() || !author.trim()) return;
    setSaving(true);
    try {
      localStorage.setItem(AUTHOR_KEY, author.trim());
      await addComment(id, author.trim(), body.trim());
      setBody('');
      setError(null);
      reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (ticket === undefined) return <p className="muted">{error || 'Loading…'}</p>;
  if (ticket === null) {
    return (
      <section>
        <h1>Ticket not found</h1>
        <p>
          It may have been deleted, or the data was reset. <Link to="">Back to tickets</Link>
        </p>
      </section>
    );
  }
  const customer = ticketCustomer(ticket);

  return (
    <section>
      <p>
        <Link to="">← Tickets</Link>
      </p>
      <div className="page-head">
        <h1>
          <span className="muted">#{ticket.number}</span> {ticket.title}
        </h1>
      </div>
      <ErrorNote error={error} />
      <div className="ticket-layout">
        <div>
          <div className="meta-row">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <span className="muted">Opened {formatDate(ticket.created)}</span>
          </div>
          <p className="description">{ticket.description || <em>No description.</em>}</p>

          <h2>Comments ({comments.length})</h2>
          <ol className="comments">
            {comments.map(c => (
              <li key={c._id}>
                <div className="comment-head">
                  <strong>{c.author}</strong>
                  <span className="muted">{formatDate(c.created)}</span>
                </div>
                <p>{c.body}</p>
              </li>
            ))}
          </ol>
          <form className="comment-form" onSubmit={submit}>
            <input
              placeholder="Your name"
              value={author}
              maxLength={60}
              onChange={e => setAuthor(e.target.value)}
              aria-label="Your name"
              required
            />
            <textarea
              placeholder="Write a comment…"
              value={body}
              maxLength={1000}
              rows={3}
              onChange={e => setBody(e.target.value)}
              aria-label="Comment"
              required
            />
            <button className="button primary" disabled={saving}>
              {saving ? 'Adding…' : 'Add comment'}
            </button>
          </form>
        </div>

        <aside className="panel">
          <label>
            Status
            <select
              value={ticket.status}
              onChange={e => change({ status: e.target.value as Status })}
            >
              {STATUSES.map(s => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select
              value={ticket.priority}
              onChange={e => change({ priority: e.target.value as Priority })}
            >
              {PRIORITIES.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <h3>Customer</h3>
          {customer ? (
            <dl className="customer">
              <dt>Name</dt>
              <dd>{customer.name}</dd>
              <dt>Email</dt>
              <dd>{customer.email}</dd>
              {customer.phone && (
                <>
                  <dt>Phone</dt>
                  <dd>{customer.phone}</dd>
                </>
              )}
              {(customer.city || customer.state) && (
                <>
                  <dt>Location</dt>
                  <dd>{[customer.city, customer.state].filter(Boolean).join(', ')}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="muted">No linked customer.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
