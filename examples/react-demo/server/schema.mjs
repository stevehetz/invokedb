// The three tables of the support desk, as setup.mjs makes them and the proxy allows them.
// Column names are what the API uses (the rows' keys).

export const STATUSES = ['open', 'in_progress', 'waiting', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

/**
 * @typedef {{ name: string, type: 'string' | 'number' | 'date' | 'link', indexed?: boolean,
 *   link?: { table: string, display: string } }} Column
 * @typedef {{ name: string, columns: Column[] }} Table
 */

/** @type {Table[]} In the order they're made: a link's table comes first. */
export const TABLES = [
  {
    name: 'Customers',
    columns: [
      { name: 'name', type: 'string', indexed: true },
      { name: 'email', type: 'string', indexed: true },
      { name: 'phone', type: 'string' },
      { name: 'city', type: 'string' },
      { name: 'state', type: 'string' }
    ]
  },
  {
    name: 'Tickets',
    columns: [
      { name: 'number', type: 'number', indexed: true },
      { name: 'title', type: 'string', indexed: true },
      { name: 'description', type: 'string' },
      { name: 'status', type: 'string', indexed: true },
      { name: 'priority', type: 'string', indexed: true },
      { name: 'created', type: 'date', indexed: true },
      {
        name: 'customer',
        type: 'link',
        link: { table: 'Customers', display: 'name' }
      }
    ]
  },
  {
    name: 'Comments',
    columns: [
      { name: 'body', type: 'string' },
      { name: 'author', type: 'string' },
      { name: 'created', type: 'date', indexed: true },
      { name: 'ticket', type: 'link', link: { table: 'Tickets', display: 'title' } }
    ]
  }
];

export const TABLE_NAMES = TABLES.map(t => t.name);
