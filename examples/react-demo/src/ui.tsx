// Small shared pieces: badges, dates, the customer list.
import { useEffect, useState } from 'react';
import { listCustomers, STATUS_LABELS, type Customer, type Priority, type Status } from './api';

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status] || status}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={`badge priority-${priority}`}>{priority}</span>;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateFormat.format(d);
}

export function timeAgo(iso: string | number, now = Date.now()) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// The customers, read once per page load (the app never changes them)
let customersPromise: Promise<Customer[]> | null = null;

export function useCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  useEffect(() => {
    let live = true;
    customersPromise ||= listCustomers().catch(e => {
      customersPromise = null;
      throw e;
    });
    customersPromise.then(
      c => live && setCustomers(c),
      () => {}
    );
    return () => {
      live = false;
    };
  }, []);
  return customers;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}
