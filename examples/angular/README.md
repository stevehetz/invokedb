# InvokeDB Examples with Angular

Three small pages built on the InvokeDB API, using the JavaScript client in
`../invokedb-node` (imported straight from its source):

- **To Do**: list, filter, add, rename, complete and delete tasks (`todo` table).
- **Contacts**: a paged, searchable list with a create / edit / delete form (`contacts`).
- **Wine Reviews**: filter by variety, country, price range and points, sort, and load more
  (`wine_reviews`, with number columns and distinct-value lookups via `$group`).

Angular 22 (standalone components, signals, zoneless), with no UI library.

## Run it

Needs Node 22.22.3+ or 24.15+ (the repo's `.nvmrc` gives you a Node 22 that works).

1. From the repo root, start InvokeDB: `npm run dev`.
2. Load the example tables and write this app's config:

   ```sh
   node examples/setup.mjs
   ```

   It logs in as `demo@invokedb.com`, uploads `examples/data/*.csv` as the `todo`, `contacts`
   and `wine_reviews` tables, sets their column types and indexes, and writes
   `public/invokedb.config.json` (gitignored) with that account's API key. Options:
   `--email`, `--password`, `--base http://127.0.0.1:8001`, and `--replace` to re-create the
   tables from the CSVs.

3. Start the app:

   ```sh
   cd examples/angular
   npm install
   npm start          # http://localhost:4200
   ```

If the config file is missing, the backend isn't running or a table doesn't exist, the page
says so and what to run.

## Where things are

- `src/app/invokedb.ts`: loads the config and hands pages a client table.
- `src/app/todo`, `src/app/contacts`, `src/app/wines`: one folder per page.
- `npm run build` builds to `dist/`; `npm run format` runs prettier (this app keeps its own
  2-space style).
