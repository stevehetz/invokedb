import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSeed, msUntilUtcHour, resetData } from '../reset.mjs';
import { feedItems } from '../events.mjs';

// An in-memory stand-in for the three tables, enough for resetData
function fakeDb() {
  const tables = { Customers: [], Tickets: [], Comments: [] };
  let n = 0;
  const id = () => (++n).toString(16).padStart(24, '0');
  return {
    tables,
    async deleteAll(table) {
      tables[table] = [];
    },
    async create(table, rows) {
      tables[table].push(...rows.map(r => ({ _id: id(), ...r })));
    },
    async queryAll(table) {
      return tables[table];
    }
  };
}

test('loads the seed with links from tickets to customers and comments to tickets', async () => {
  const db = fakeDb();
  db.tables.Tickets.push({ _id: 'old', title: 'vandalised' });
  const seed = loadSeed();
  const now = Date.parse('2026-11-28T04:00:00Z');
  const counts = await resetData(db, seed, now);

  assert.equal(counts.customers, seed.customers.length);
  assert.equal(db.tables.Tickets.length, seed.tickets.length);
  assert.ok(!db.tables.Tickets.some(t => t._id === 'old'));
  const customerIds = new Set(db.tables.Customers.map(c => c._id));
  const ticketIds = new Set(db.tables.Tickets.map(t => t._id));
  assert.ok(
    db.tables.Tickets.every(t => t.customer.length === 1 && customerIds.has(t.customer[0]))
  );
  assert.ok(db.tables.Comments.every(c => ticketIds.has(c.ticket[0])));
  // Times are relative to the reset
  assert.ok(db.tables.Tickets.every(t => Date.parse(t.created) < now));
  const first = seed.tickets[0];
  const made = db.tables.Tickets.find(t => t.number === first.number);
  assert.equal(made.created, new Date(now - first.created_minutes_ago * 60_000).toISOString());
});

test('the seed only uses the statuses and priorities the app knows', async () => {
  const { STATUSES, PRIORITIES } = await import('../schema.mjs');
  const seed = loadSeed();
  assert.ok(seed.tickets.every(t => STATUSES.includes(t.status)));
  assert.ok(seed.tickets.every(t => PRIORITIES.includes(t.priority)));
});

test('the next reset is at the given hour UTC', () => {
  const at = Date.parse('2026-11-28T03:30:00Z');
  assert.equal(msUntilUtcHour(4, at), 30 * 60_000);
  assert.equal(msUntilUtcHour(4, Date.parse('2026-11-28T04:00:00Z')), 24 * 3600_000);
  assert.equal(msUntilUtcHour(4, Date.parse('2026-11-28T05:00:00Z')), 23 * 3600_000);
});

test('feed items: only the three tables, clipped, deletes without text', () => {
  assert.deepEqual(feedItems({ event: 'ping', table: null, rows: [] }), []);
  assert.deepEqual(
    feedItems({ event: 'row.created', table: { name: 'Other' }, rows: [{ _id: 'x' }] }),
    []
  );
  const [comment] = feedItems({
    id: 'd',
    event: 'row.created',
    table: { name: 'Comments' },
    rows: [{ _id: 'c1', author: 'Robin', body: 'x'.repeat(500) }]
  });
  assert.ok(comment.label.startsWith('Robin: x'));
  assert.ok(comment.label.length <= 100);
  const many = feedItems({
    id: 'd',
    event: 'row.deleted',
    table: { name: 'Tickets' },
    rows: Array.from({ length: 25 }, (_, i) => ({ _id: `r${i}` }))
  });
  assert.equal(many.length, 11);
  assert.equal(many[0].label, '');
  assert.equal(many[10].label, 'and 15 more rows');
});
