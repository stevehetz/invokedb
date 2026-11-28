// A kanban of tickets by status. Dragging a card to another column is one row update
// (PUT /api/v1/update with the new status); the card moves at once and goes back if the
// update is refused. Changes made elsewhere arrive through the live feed.
import { useCallback, useEffect, useState, type DragEvent } from 'react';
import {
  boardTickets,
  errorMessage,
  STATUSES,
  STATUS_LABELS,
  ticketCustomer,
  updateTicket,
  type Status,
  type Ticket
} from '../api';
import { useLiveChanges } from '../live';
import { Link } from '../router';
import { ErrorNote, PriorityBadge } from '../ui';

type Columns = Record<Status, Ticket[]>;

export function Board() {
  const [columns, setColumns] = useState<Columns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);

  // Bumped to read the board again (a change in the live feed)
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let live = true;
    boardTickets().then(
      c => {
        if (!live) return;
        setColumns(c);
        setError(null);
      },
      e => live && setError(errorMessage(e))
    );
    return () => {
      live = false;
    };
  }, [version]);
  useLiveChanges(['Tickets', 'Customers'], reload);

  function onDragStart(e: DragEvent, ticket: Ticket) {
    e.dataTransfer.setData('text/plain', ticket._id);
    e.dataTransfer.effectAllowed = 'move';
  }

  async function onDrop(e: DragEvent, status: Status) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!columns || !id) return;
    const from = STATUSES.find(s => columns[s].some(t => t._id === id));
    if (!from || from === status) return;
    const ticket = columns[from].find(t => t._id === id)!;
    const before = columns;
    setColumns({
      ...columns,
      [from]: columns[from].filter(t => t._id !== id),
      [status]: [{ ...ticket, status }, ...columns[status]]
    });
    try {
      await updateTicket(id, { status });
    } catch (err) {
      setColumns(before);
      setError(errorMessage(err));
    }
  }

  return (
    <section>
      <div className="page-head">
        <h1>Board</h1>
        <span className="muted">Drag a card to change its status.</span>
      </div>
      <ErrorNote error={error} />
      <div className="board">
        {STATUSES.map(status => (
          <div
            key={status}
            className={`board-column${over === status ? ' over' : ''}`}
            onDragOver={e => {
              e.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver(o => (o === status ? null : o))}
            onDrop={e => onDrop(e, status)}
          >
            <h2>
              {STATUS_LABELS[status]}
              <span className="muted"> {columns ? columns[status].length : ''}</span>
            </h2>
            {columns?.[status].map(t => (
              <article key={t._id} className="card" draggable onDragStart={e => onDragStart(e, t)}>
                <Link to={`tickets/${t._id}`}>
                  <span className="muted">#{t.number}</span> {t.title}
                </Link>
                <div className="card-meta">
                  <PriorityBadge priority={t.priority} />
                  <span className="muted">{ticketCustomer(t)?.name}</span>
                </div>
              </article>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
