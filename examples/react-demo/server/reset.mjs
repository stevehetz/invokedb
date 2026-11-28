// Puts the demo's tables back to the seed set (seed/seed.json): deletes every row, then loads
// the customers, the tickets linked to them and the comments linked to the tickets. The seed's
// times are minutes before the reset, so the data always looks recent. Run nightly by the
// server, on demand with `npm run reset` (or SIGUSR2 to the running server), and by setup.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SEED_FILE = path.join(here, '..', 'seed', 'seed.json');

export function loadSeed(file = SEED_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const ago = (now, minutes) => new Date(now - minutes * 60_000).toISOString();

/**
 * @param {ReturnType<typeof import('./invokedb.mjs').createInvokeDB>} db
 * @param {{ customers: any[], tickets: any[], comments: any[] }} seed
 * @returns {Promise<{ customers: number, tickets: number, comments: number }>}
 */
export async function resetData(db, seed, now = Date.now()) {
  // Comments link to tickets and tickets to customers: delete from the end of the chain, so
  // InvokeDB has fewer links to clear
  for (const table of ['Comments', 'Tickets', 'Customers']) await db.deleteAll(table);

  await db.create('Customers', seed.customers);
  const customerIds = new Map(
    (await db.queryAll('Customers', { fields: ['email'] })).map(r => [r.email, r._id])
  );

  await db.create(
    'Tickets',
    seed.tickets.map(t => ({
      number: t.number,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      created: ago(now, t.created_minutes_ago),
      customer: customerIds.has(t.customer_email) ? [customerIds.get(t.customer_email)] : null
    }))
  );
  const ticketIds = new Map(
    (await db.queryAll('Tickets', { fields: ['number'] })).map(r => [r.number, r._id])
  );

  await db.create(
    'Comments',
    seed.comments
      .filter(c => ticketIds.has(c.ticket_number))
      .map(c => ({
        body: c.body,
        author: c.author,
        created: ago(now, c.created_minutes_ago),
        ticket: [ticketIds.get(c.ticket_number)]
      }))
  );
  return {
    customers: customerIds.size,
    tickets: ticketIds.size,
    comments: seed.comments.length
  };
}

/** Milliseconds until the next `hour`:00 UTC after `now`. */
export function msUntilUtcHour(hour, now = Date.now()) {
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now;
}
