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
