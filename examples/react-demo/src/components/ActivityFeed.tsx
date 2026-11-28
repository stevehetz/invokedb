import { useFeed, useNow, type FeedItem } from '../live';
import { Link } from '../router';
import { timeAgo } from '../ui';

const VERB: Record<FeedItem['event'], string> = {
  'row.created': 'added',
  'row.updated': 'changed',
  'row.deleted': 'deleted'
};

const NOUN: Record<FeedItem['table'], string> = {
  Customers: 'customer',
  Tickets: 'ticket',
  Comments: 'comment'
};

export function ActivityFeed() {
  const { items, connected } = useFeed();
  const now = useNow();
  return (
    <section className="panel feed" aria-live="polite">
      <h2>
        Live activity
        <span
          className={`dot ${connected ? 'on' : 'off'}`}
          title={connected ? 'Live' : 'Reconnecting'}
        />
      </h2>
      <p className="muted small">
        Every row change, from this app, the InvokeDB grid or the API, arrives here by webhook.
      </p>
      {items.length === 0 && <p className="muted">Nothing yet. Change a ticket to see it.</p>}
      <ul>
        {items.map(item => (
          <li key={item.id} className={`feed-${item.event.replace('row.', '')}`}>
            <div>
              <strong>
                {NOUN[item.table]} {VERB[item.event]}
              </strong>{' '}
              <span className="muted small">{timeAgo(item.receivedAt, now)}</span>
            </div>
            {item.label &&
              (item.table === 'Tickets' && item.event !== 'row.deleted' ? (
                <Link to={`tickets/${item.rowId}`}>{item.label}</Link>
              ) : (
                <span>{item.label}</span>
              ))}
            {item.detail && <div className="muted small">{item.detail}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
