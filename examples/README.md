# Examples

- `invokedb-node/`: the JavaScript/TypeScript client for the InvokeDB API (npm `invokedb`).
- `invokedb-python/`: the Python client for the same API (standard library only, typed, not on
  PyPI), with `example.py` and tests (`python3 -m unittest discover -s tests`, offline; set
  `INVOKEDB_TEST_BASE` to also run them against a backend).
- `angular/`: an Angular app (to-do list, contacts, wine reviews) built on the client.
- `react-demo/`: a support desk in React (tickets, a kanban, linked customers and comments, and
  a live activity feed driven by webhooks), with a small Node server that holds the API key.
  Deployed at <https://examples.invokedb.com/react-demo>; its README says how to run it and how
  it's set up (`react-demo/setup.mjs`).
- `data/`: made-up example data. `node examples/data/generate.mjs` regenerates the CSVs (the
  output is the same on every run). All names, addresses and wineries are invented, phone
  numbers use the fictional 555-01xx range and emails use example.com.
- `data/test/`: made-up order CSVs of three sizes for testing uploads and large grids
  (`orders_small` 100 rows, `orders_medium` 5,000, `orders_large` 50,000). `setup.mjs` doesn't
  load them. `node examples/data/test/generate.mjs` regenerates them.
- `setup.mjs`: loads the CSVs into a running InvokeDB as tables, sets column types and
  indexes, and writes the Angular app's API key config. Its options (`--email`, `--password`,
  `--base`, `--replace`) are described at the top of the file.

Quick start (from the repo root, with `npm run dev` running):

```sh
node examples/setup.mjs
cd examples/angular && npm install && npm start
```

Each example has its own `node_modules`, and the JavaScript ones keep their own prettier style,
so they're listed in the root `.prettierignore`.
