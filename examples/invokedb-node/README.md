# InvokeDB JavaScript Client

A small, dependency-free client for the InvokeDB table API. It uses the built-in `fetch`, so it
runs in Node 18+ and in any current browser, and ships CommonJS, ES module and TypeScript
builds.

There's no public InvokeDB API at the moment, so the client defaults to a local backend at
`http://127.0.0.1:8001/api/v1` (`npm run dev` from the repo root).

## Build

```sh
npm install
npm run build      # dist/cjs, dist/es (+ .d.ts)
```

The Angular example (`../angular`) uses this source directly, so it doesn't need a build.

## Usage

Get your API key from the Account page (http://127.0.0.1:8000/app/account), or run
`node examples/setup.mjs` from the repo root, which loads the example tables and prints it.

```js
import { InvokeDBClient } from 'invokedb';

const db = new InvokeDBClient({ apiKey: process.env.INVOKEDB_API_KEY });
// Or point it somewhere else: new InvokeDBClient({ apiKey, baseUrl: 'https://…/api/v1' })

const wines = db.table('wine_reviews');

// Get rows: { count, data: [{ _id, ...columns }] }
const page = await wines.find().skip(0).limit(20).exec();

// Search, sort and page
const top = await wines
  .find({
    country: { $eq: 'France' },
    price: [{ $gte: 20 }, { $lte: 60 }], // several conditions on one column
    points: { $gte: 90 }
  })
  .sortBy('points')
  .sortDir('desc')
  .limit(10)
  .exec();

// Any of several columns: $or. Case-insensitive "contains": $ctn
const people = await db
  .table('contacts')
  .find({ $or: { first_name: { $ctn: 'av' }, last_name: { $ctn: 'av' } } })
  .exec();

// Distinct values of a column
const countries = await wines.find({ $group: 'country' }).limit(100).exec();

const total = await wines.count();

// Query: several filters, sort by several columns, only some columns, cursor paging
const query = {
  filters: [
    { column: 'country', op: 'in', value: ['France', 'Italy'] },
    { column: 'points', op: 'gte', value: 90 },
    { column: 'designation', op: 'empty', value: false }
  ],
  sort: ['-points', 'price'], // "-" for descending
  fields: ['title', 'points', 'price'],
  limit: 50
};
let res = await wines.query(query); // { data: [...], next_cursor }
while (res.next_cursor) {
  // the same query with the cursor; pages stay in order when rows are added
  res = await wines.query({ ...query, cursor: res.next_cursor });
}
const french = await wines.count({
  filters: [{ column: 'country', op: 'eq', value: 'France' }]
});
const first = await wines.findOne({ title: { $ctn: 'Riesling' } }).exec(); // row or null

// Write
const todo = db.table('todo');
await todo.insert({ name: 'Water the plants', is_complete: 'no' }); // or an array of rows
const task = await todo.findOne({ name: 'Water the plants' }).exec();
await todo.update({ _id: task._id, is_complete: 'yes' }); // only the columns you pass change
await todo.delete(task._id); // or an array of _ids
```

Filter operators: `$eq`, `$ctn` (contains, case-insensitive), `$gt`, `$gte`, `$lt`, `$lte`.
A plain value means `$eq`. Number and date columns take the range operators; set a column's
type on the table's Edit Columns screen (or let `examples/setup.mjs` do it).

Date columns come back as ISO 8601 strings in UTC with milliseconds
(`'2026-11-28T12:01:29.123Z'`), so `new Date(row.joined)` reads them exactly. Send a date as
ISO 8601 (`'2026-11-28T12:01:29.123Z'`, or just `'2026-11-28'`); what you write is what you read
back.

`query()` and `count({ filters })` take `{ column, op, value }` filters with the operators `eq`,
`ne`, `gt`, `gte`, `lt`, `lte`, `in` (an array), `contains` (text, case-insensitive unless
`case: 'sensitive'`) and `empty` (`true` or `false`); they all have to match, or any of them
with `match: 'any'`. `eq` on text is exact and case-sensitive, and uses the column's index.

Failed requests throw an `InvokeDBError` with `status` and the response `body`.

## Changes in 2.0.0

- `fetch` instead of axios: no runtime dependencies, and Node works. (The 1.x build bundled
  axios's browser adapter into every output, so it couldn't run in Node.)
- Default `baseUrl` is the local backend; the old `api.invokedb.com` host is gone.
- `insert`, `update` and `delete` return the response body instead of an axios response.
- Errors are `InvokeDBError`s, not strings.
- Built with `tsc` (CommonJS + ES modules) instead of rollup; `exports` map, Node 18+.

## Publishing

2.0.0 isn't published yet (npm has 1.0.27). To publish, from this folder:
`npm run build && npm publish`.
