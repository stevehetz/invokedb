# Examples

- `invokedb-node/`: the JavaScript/TypeScript client for the InvokeDB API (npm `invokedb`).
- `angular/`: an Angular app (to-do list, contacts, wine reviews) built on the client.
- `data/`: made-up example data. `node examples/data/generate.mjs` regenerates the CSVs (the
  output is the same on every run). All names, addresses and wineries are invented, phone
  numbers use the fictional 555-01xx range and emails use example.com.
- `setup.mjs`: loads the CSVs into a running InvokeDB as tables, sets column types and
  indexes, and writes the Angular app's API key config. Its options (`--email`, `--password`,
  `--base`, `--replace`) are described at the top of the file.

Quick start (from the repo root, with `npm run dev` running):

```sh
node examples/setup.mjs
cd examples/angular && npm install && npm start
```

Each example has its own `node_modules`, and both keep their own prettier style, so they're
listed in the root `.prettierignore`.
