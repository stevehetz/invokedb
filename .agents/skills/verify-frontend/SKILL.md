---
name: verify-frontend
description: Verify a horizon-fe or horizon-auth-fe change by running the Playwright UI smoke test against a throwaway stack and diffing its output before and after. Use after any frontend change (components, store, routing, dependencies, build config, the Vue 3 / Vite migration) and before saying a UI change works.
---

# Verify a frontend change

There are no frontend unit tests. The evidence that a change is safe is: **it builds**, **the
UI smoke test passes**, and **its observations match the baseline** (or differ only where you
meant them to).

`scripts/ui-smoke.mjs` drives the installed Chrome (the `playwright` npm package with
`channel: 'chrome'`, so no browser download and no native build) through:

| Step                       | What it checks                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `login`                    | log in on the auth app (:8105), get redirected to the main app (:8100) with the email shown                                     |
| `upload_csv`               | `+` → Table from CSV → upload; tab opens with 3 rows; `WEB_FILE_PROCESS_COMPLETE` arrives over the websocket                    |
| `sort`                     | header click: ascending, descending, cleared (server-side sort)                                                                 |
| `filter`                   | floating "contains" filter on `name` narrows to 2 rows, clearing restores 3                                                     |
| `cell_edit`                | double-click a cell, type, Enter; the grid shows it and the backend saved it                                                    |
| `add_column`               | Edit Columns → Add Column → name it → save; shown and saved                                                                     |
| `remove_column`            | Edit Columns → ⊖ on `joined` → save; gone from grid and backend                                                                 |
| `websocket_type_change`    | change `age` to number + index → background job; grid reloads only after `WEB_FILE_PROCESS_START`/`COMPLETE` over the websocket |
| `api_key_and_external_api` | Account page shows the API key; `/api/v1/get` with that key returns the table                                                   |
| `delete_table`             | select the table in the tree → trash → Confirm; tab closes, backend has no table                                                |
| `logout`                   | sign-out icon returns to the auth app                                                                                           |

It stops at the first failing step, prints a screenshot path, and removes its table
(`ui_smoke_people` under `demo@invokedb.com`) unless you pass `--keep`. A leftover table from a
crashed run is removed at the start of the next one. `--headed` shows the browser.

## 1. Build

```sh
bash -c 'source scripts/env.sh && npm --prefix packages/horizon-fe run build && npm --prefix packages/horizon-auth-fe run build'
```

`env.sh` must be sourced from bash (it uses `BASH_SOURCE`), and Vue CLI 4 needs the
`NODE_OPTIONS` it sets. The output goes to each package's gitignored `dist/`. After the Vite
migration, use whatever the build command is then.

## 2. Throwaway stack (never smoke-test against the user's real data)

```sh
S=<scratch dir>
bash scripts/smoke-env.sh "$S/smoke.env"          # DBs horizon_smoke*, ports 8100/8105/8101/9100
HORIZON_ENV_FILE="$S/smoke.env" bash scripts/db-setup.sh   # creates DBs, runs migrations (seeds demo logins)
HORIZON_ENV_FILE="$S/smoke.env" bash scripts/dev.sh > "$S/stack.log" 2>&1   # run in the background
```

Wait until all three answer (first webpack build: about 30–60s):

```sh
for p in 8101 8100 8105; do curl -s -o /dev/null -w "$p %{http_code}\n" http://127.0.0.1:$p/; done
```

The backend answers `404` on `/`; that's fine. The smoke stack runs alongside a normal
`npm run dev` because every port differs.

> ⚠️ **Never** run `db-setup.sh --reset` or `db-demo.sh` with the smoke env. Their Mongo drop
> filters on the `horizon` prefix, not on the configured DB name, so they would wipe the user's
> real `horizon*` databases too.

## 3. Baseline, then the change

```sh
run() { HORIZON_ENV_FILE="$S/smoke.env" bash -c "source scripts/env.sh && node scripts/ui-smoke.mjs --out $1"; }
run "$S/before.json"       # on the code before your change; every line should say "ok"
# apply your change (the dev servers hot-reload; restart the stack for config/dependency changes)
run "$S/after.json"
diff <(jq -S . "$S/before.json") <(jq -S . "$S/after.json")
```

The JSON has no IDs, tokens or timings, so on unchanged code two runs are identical. Any diff
is a behaviour change. Explain it, or fix it. `observed.page_errors` lists uncaught JS errors;
new ones are regressions even when every step passes.

If your change touches a flow the script doesn't cover, add a step (keep it self-cleaning,
and check the backend saw the change, not just the DOM) rather than checking by hand once.

## 4. Writing and fixing steps: selector notes

- ag-grid header cells have `col-id` (`a`, `b`, … not the header name); `col_id(name)` maps
  them. Floating filter cells have no `col-id`; match them by `aria-colindex`.
- In Edit Columns mode the labels become inputs, and the `Row` header has none. Use
  `edit_header(name)`; calling `inputValue()` on a header without an input waits out the
  15s default timeout.
- The filter and header-name inputs react to `keyup`, not `input`, so use
  `pressSequentially`, not just `fill`.
- Add Column fetches the new column from the backend first: wait for the extra header input
  to appear before typing.
- The app's websocket is `HORIZON_SB_PUB_WS_URL`; webpack-dev-server opens its own
  `sockjs-node` socket on the LAN IP, which the script ignores.
- For poking around interactively, the Playwright MCP server (`.mcp.json`) drives the same
  Chrome.

## 5. Clean up only the throwaway data

Stop the background stack, then:

```sh
PGHOST=127.0.0.1 PGUSER=postgres psql -d postgres -c 'DROP DATABASE IF EXISTS horizon_smoke WITH (FORCE)' -c 'DROP DATABASE IF EXISTS horizon_smoke_logs WITH (FORCE)'
mongosh mongodb://127.0.0.1:27017 --quiet --eval 'db.adminCommand({listDatabases:1}).databases.filter(d=>d.name.startsWith("horizon_smoke")).forEach(d=>db.getSiblingDB(d.name).dropDatabase())'
rm -rf .data/smoke
```

Or keep the smoke DBs for the next session; `db-setup.sh` on them is idempotent.

Report the results as they are: which steps ran, and paste any non-trivial diff.
