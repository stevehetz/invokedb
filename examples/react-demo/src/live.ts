// The live activity feed. InvokeDB sends a webhook to this app's server on every row change
// (from this app, from someone editing the tables in InvokeDB, or from the API); the server
// checks its signature and passes it on to every browser over server-sent events (GET /events).
// One EventSource for the whole page; components subscribe to it.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BASE } from './api';

export interface FeedItem {
  id: string;
  at: string;
  event: 'row.created' | 'row.updated' | 'row.deleted';
  table: 'Customers' | 'Tickets' | 'Comments';
  rowId: string;
  label: string;
  detail: string;
  // When this browser received it
  receivedAt: number;
}

type Listener = () => void;
type ChangeListener = (item: FeedItem | null) => void;

const MAX_ITEMS = 50;
let items: FeedItem[] = [];
let connected = false;
const listeners = new Set<Listener>();
const changeListeners = new Set<ChangeListener>();
let source: EventSource | null = null;

const notify = () => listeners.forEach(l => l());

function connect() {
  if (source) return;
  source = new EventSource(`${BASE}events`);
  source.onopen = () => {
    connected = true;
    notify();
  };
  source.onerror = () => {
    // EventSource reconnects by itself (the server asks for 3 s)
    connected = false;
    notify();
  };
  source.addEventListener('change', e => {
    const item = { ...JSON.parse((e as MessageEvent).data), receivedAt: Date.now() } as FeedItem;
    if (items.some(i => i.id === item.id)) return; // sent again after a reconnect
    items = [item, ...items].slice(0, MAX_ITEMS);
    notify();
    changeListeners.forEach(l => l(item));
  });
  source.addEventListener('reset', e => {
    const data = JSON.parse((e as MessageEvent).data);
    if (data.state === 'done') {
      items = [];
      notify();
      // null: everything changed
      changeListeners.forEach(l => l(null));
    }
  });
}

function subscribe(l: Listener) {
  connect();
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The feed's items, newest first, and whether the stream is open. */
export function useFeed() {
  const feed = useSyncExternalStore(subscribe, () => items);
  const isConnected = useSyncExternalStore(subscribe, () => connected);
  return { items: feed, connected: isConnected };
}

/**
 * Calls `onChange` (at most every 400 ms) when a row of one of `tables` changes, so a page can
 * read its data again: the board moves a card someone dragged in another browser, the ticket
 * page shows a comment added through the API.
 */
export function useLiveChanges(tables: FeedItem['table'][], onChange: () => void) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  const key = tables.join(',');
  useEffect(() => {
    connect();
    const wanted = key.split(',');
    let timer: ReturnType<typeof setTimeout> | null = null;
    const listener: ChangeListener = item => {
      if (item && !wanted.includes(item.table)) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        cb.current();
      }, 400);
    };
    changeListeners.add(listener);
    return () => {
      changeListeners.delete(listener);
      if (timer) clearTimeout(timer);
    };
  }, [key]);
}

/** Re-renders every `ms` (for "5 s ago" labels). */
export function useNow(ms = 5000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
