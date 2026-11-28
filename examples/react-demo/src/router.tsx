// A few routes don't need a router library: the path (after the base) picks the page, links
// push history entries, and the back button works through popstate.
import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import { BASE } from './api';

export type Route =
  | { page: 'tickets' }
  | { page: 'board' }
  | { page: 'new' }
  | { page: 'ticket'; id: string }
  | { page: 'missing' };

export function parseRoute(pathname: string): Route {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : '';
  const parts = rest.split('/').filter(Boolean);
  if (parts.length === 0) return { page: 'tickets' };
  if (parts.length === 1 && parts[0] === 'board') return { page: 'board' };
  if (parts.length === 1 && parts[0] === 'new') return { page: 'new' };
  if (parts.length === 2 && parts[0] === 'tickets' && /^[0-9a-f]{24}$/i.test(parts[1])) {
    return { page: 'ticket', id: parts[1] };
  }
  return { page: 'missing' };
}

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach(l => l()));

export function navigate(to: string) {
  window.history.pushState(null, '', BASE + to.replace(/^\//, ''));
  window.scrollTo(0, 0);
  listeners.forEach(l => l());
}

export function usePathname() {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => window.location.pathname
  );
}

export function Link({
  to,
  className,
  children
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={BASE + to.replace(/^\//, '')} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
