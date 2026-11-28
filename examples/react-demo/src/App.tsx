import { ActivityFeed } from './components/ActivityFeed';
import { HowItWorks } from './components/HowItWorks';
import { Board } from './pages/Board';
import { NewTicket } from './pages/NewTicket';
import { TicketList } from './pages/TicketList';
import { TicketPage } from './pages/TicketPage';
import { Link, parseRoute, usePathname } from './router';

export function App() {
  const route = parseRoute(usePathname());
  const tab = (page: string) => (route.page === page ? 'tab active' : 'tab');

  return (
    <div className="app">
      <header className="top">
        <Link to="" className="brand">
          Support desk
        </Link>
        <span className="muted small">an InvokeDB example</span>
        <nav>
          <Link to="" className={tab('tickets')}>
            Tickets
          </Link>
          <Link to="board" className={tab('board')}>
            Board
          </Link>
          <Link to="new" className={tab('new')}>
            New ticket
          </Link>
        </nav>
      </header>
      <div className="layout">
        <main>
          {route.page === 'tickets' && <TicketList />}
          {route.page === 'board' && <Board />}
          {route.page === 'new' && <NewTicket />}
          {route.page === 'ticket' && <TicketPage key={route.id} id={route.id} />}
          {route.page === 'missing' && (
            <section>
              <h1>Not found</h1>
              <Link to="">Back to tickets</Link>
            </section>
          )}
        </main>
        <aside className="side">
          <ActivityFeed />
          <HowItWorks />
        </aside>
      </div>
    </div>
  );
}
