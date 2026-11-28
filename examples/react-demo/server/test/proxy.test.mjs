import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApiCall, Refusal } from '../proxy.mjs';

const ID = '0123456789abcdef01234567';
const call = (method, action, query, body) =>
  checkApiCall({ method, action, params: new URLSearchParams(query), body });
const refused = (status, fn) => assert.throws(fn, e => e instanceof Refusal && e.status === status);

const ticket = {
  number: 1100,
  title: 'Printer on fire',
  description: 'Smoke everywhere',
  status: 'open',
  priority: 'urgent',
  created: '2026-11-28T10:00:00.000Z',
  customer: [ID]
};

test('allows the queries the app makes, on the three tables', () => {
  for (const table of ['Customers', 'Tickets', 'Comments']) {
    const out = call('POST', 'query', { table }, { limit: 50 });
    assert.deepEqual(out, {
      method: 'POST',
      path: `/query?table=${table}`,
      body: { limit: 50 }
    });
    assert.equal(call('POST', 'count', { table }, {}).path, `/count?table=${table}`);
  }
  const q = {
    filters: [{ column: 'status', op: 'eq', value: 'open' }],
    sort: [{ column: 'created', dir: 'desc' }],
    limit: 25,
    cursor: 'abc'
  };
  const out = call('POST', 'query', { table: 'Tickets', expand: 'customer' }, q);
  assert.equal(out.path, '/query?table=Tickets&expand=customer');
  assert.deepEqual(out.body, q);
});

test('allows creating tickets and comments and updating tickets, one row at a time', () => {
  assert.deepEqual(call('POST', 'create', { table: 'Tickets' }, [ticket]).body, [ticket]);
  const comment = {
    body: 'On it',
    author: 'Robin',
    created: '2026-11-28T10:00:00Z',
    ticket: ID
  };
  assert.deepEqual(call('POST', 'create', { table: 'Comments' }, [comment]).body, [
    { ...comment, ticket: [ID] }
  ]);
  const upd = call('PUT', 'update', { table: 'Tickets' }, [{ _id: ID, status: 'closed' }]);
  assert.deepEqual(upd, {
    method: 'PUT',
    path: '/update?table=Tickets',
    body: [{ _id: ID, status: 'closed' }]
  });
});

test('refuses other tables, actions and methods', () => {
  refused(403, () => call('POST', 'query', { table: 'Users' }, {}));
  refused(403, () => call('POST', 'query', { table: 'tickets' }, {}));
  refused(403, () => call('POST', 'query', { table: '__proto__' }, {}));
  refused(400, () => call('POST', 'query', {}, {}));
  refused(400, () => call('POST', 'query', 'table=Tickets&table=Users', {}));
  refused(404, () => call('POST', 'delete', { table: 'Tickets' }, [ID]));
  refused(404, () => call('GET', 'get', { table: 'Tickets' }));
  refused(404, () => call('GET', 'openapi', { table: 'Tickets' }));
  refused(404, () => call('POST', 'constructor', { table: 'Tickets' }, {}));
  refused(405, () => call('GET', 'query', { table: 'Tickets' }));
  refused(405, () => call('POST', 'update', { table: 'Tickets' }, [{ _id: ID }]));
  refused(403, () => call('POST', 'create', { table: 'Customers' }, [{ name: 'x' }]));
  refused(403, () => call('PUT', 'update', { table: 'Comments' }, [{ _id: ID, body: 'x' }]));
});

test('refuses extra parameters and expands the app does not use', () => {
  refused(400, () => call('POST', 'query', { table: 'Tickets', format: 'camelCase' }, {}));
  refused(403, () => call('POST', 'query', { table: 'Comments', expand: 'ticket' }, {}));
  refused(403, () => call('POST', 'count', { table: 'Tickets', expand: 'customer' }, {}));
  refused(403, () => call('POST', 'query', 'table=Tickets&expand=customer&expand=customer', {}));
});

test('checks query bodies', () => {
  refused(400, () => call('POST', 'query', { table: 'Tickets' }, []));
  refused(400, () => call('POST', 'query', { table: 'Tickets' }, { limit: 1000 }));
  refused(400, () => call('POST', 'query', { table: 'Tickets' }, { explain: true }));
  refused(400, () => call('POST', 'count', { table: 'Tickets' }, { sort: ['title'] }));
  const many = Array.from({ length: 11 }, () => ({ column: 'title', op: 'eq', value: 'x' }));
  refused(400, () => call('POST', 'query', { table: 'Tickets' }, { filters: many }));
});

test('checks rows: only known fields, valid values, one row', () => {
  const create = row => call('POST', 'create', { table: 'Tickets' }, [row]);
  refused(400, () => create({ ...ticket, status: 'deleted' }));
  refused(400, () => create({ ...ticket, priority: 'whenever' }));
  refused(400, () => create({ ...ticket, title: '   ' }));
  refused(400, () => create({ ...ticket, title: 'x'.repeat(121) }));
  refused(400, () => create({ ...ticket, description: 'x'.repeat(2001) }));
  refused(400, () => create({ ...ticket, customer: ['nope'] }));
  refused(400, () => create({ ...ticket, customer: [ID, ID] }));
  refused(400, () => create({ ...ticket, created: 'yesterday' }));
  refused(400, () => create({ ...ticket, number: -1 }));
  refused(400, () => create({ ...ticket, secret_column: 1 }));
  refused(400, () => create({ ...ticket, _id: ID }));
  const { customer: _c, ...noCustomer } = ticket;
  refused(400, () => create(noCustomer));
  refused(400, () => call('POST', 'create', { table: 'Tickets' }, [ticket, ticket]));
  refused(400, () => call('POST', 'create', { table: 'Tickets' }, ticket));
  refused(400, () => call('POST', 'create', { table: 'Tickets' }, []));

  const update = row => call('PUT', 'update', { table: 'Tickets' }, [row]);
  refused(400, () => update({ status: 'open' }));
  refused(400, () => update({ _id: 'x', status: 'open' }));
  refused(400, () => update({ _id: ID }));
  refused(400, () => update({ _id: ID, number: 1 }));
  refused(400, () => update({ _id: ID, customer: [ID] }));
});
