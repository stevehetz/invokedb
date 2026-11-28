const SOURCE = 'https://github.com/stevehetzl/invokedb/tree/main/examples/react-demo';

export function HowItWorks() {
  return (
    <details className="panel how">
      <summary>How this works</summary>
      <p>
        Three InvokeDB tables, <code>Customers</code>, <code>Tickets</code> and{' '}
        <code>Comments</code>, linked by link columns. A small Node server holds the API key and
        passes on only the calls below; the browser never sees a key.
      </p>
      <ul>
        <li>
          <strong>Ticket list</strong>:{' '}
          <code>POST /api/v1/query?table=Tickets&amp;expand=customer</code> with filters, a sort and
          cursor paging; <code>/count</code> for the total.
        </li>
        <li>
          <strong>Board</strong>: one query per status; dragging a card is{' '}
          <code>PUT /api/v1/update</code> with the new status.
        </li>
        <li>
          <strong>Ticket page</strong>: the ticket with its customer (<code>expand</code>), its
          comments (a filter on the Comments table's link column), and{' '}
          <code>POST /api/v1/create</code> for a new comment.
        </li>
        <li>
          <strong>Live activity</strong>: an InvokeDB webhook on every row change calls the server,
          which checks the <code>InvokeDB-Signature</code> (HMAC-SHA256) and streams the change to
          every browser with server-sent events.
        </li>
      </ul>
      <p className="muted small">The data is reset every night.</p>
      <p>
        <a href={SOURCE}>Source on GitHub</a> · <a href="https://invokedb.com">invokedb.com</a>
      </p>
    </details>
  );
}
