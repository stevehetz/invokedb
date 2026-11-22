---
name: dev-stack
description: Start, health-check, stop and inspect the local InvokeDB stack (NestJS backend, Vue 3 frontend, Postgres, MongoDB). Use when asked to run or launch the app, check it's up, look at logs, or query local Postgres/Mongo data.
---

# Local dev stack

## Prerequisites (check before starting)

```sh
pg_isready -h 127.0.0.1 -p 5432                                     # Postgres.app / brew
mongosh mongodb://127.0.0.1:27017 --quiet --eval 'db.runCommand({ping:1}).ok'   # → 1
test -f .env || echo "no .env: run npm run setup (or the backend uses .env.example defaults)"
```

If a package has no or stale `node_modules`, run `npm install` at the root: its `postinstall`
installs both packages (`horizon-be` with `--omit=optional`).

## Start

```sh
npm run dev      # backend :8001 (ws :9000), horizon-fe :8000 (site at /, app at /app)
```

- From an agent, run it with `run_in_background`. The first webpack builds take about 30–60s.
- **Postgres.app gotcha:** if the backend log shows `failed to verify "trust" authentication`
  after about 60s, Postgres.app is waiting for a permission click. Stop, and ask the user to run
  `npm run dev` in their own terminal (or turn the check off in Postgres.app → Settings).
- Only one stack can run at a time (fixed ports). Check first: `lsof -nP -iTCP:8001,8000,9000 -sTCP:LISTEN`.

## Health check

```sh
curl -s -o /dev/null -w 'be %{http_code}\n'   http://127.0.0.1:8001/auth/authorize   # 200
curl -s -o /dev/null -w 'fe %{http_code}\n'   http://127.0.0.1:8000/                 # 200
curl -s -X POST http://127.0.0.1:8001/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@invokedb.com","password":"password"}' | jq .token
```

In a browser (Playwright MCP): open http://127.0.0.1:8000/login, log in as `demo@invokedb.com` /
`password`, and it redirects to the app at :8000/app.

## Logs

Both log to the `npm run dev` output, prefixed `[be]` and `[fe]`. Without
Mailgun keys, emails (welcome, password reset links) are printed in the `[be]` output.

## Stop

Ctrl-C (or stop the background task). If ports stay taken, kill only the processes listening on
those ports: `lsof -tiTCP:8001,8000,9000 -sTCP:LISTEN | xargs kill`.

## Inspect data (read-only unless the user asks)

Postgres (accounts, sessions, subscriptions, file directory, jobs, migrations):

```sh
PGHOST=127.0.0.1 PGUSER=postgres psql horizon -c '\dt'
PGHOST=127.0.0.1 PGUSER=postgres psql horizon -c 'select id, email from account order by id'
```

Mongo (grid data; one DB per account). Prefer the `mongodb` MCP server, which is read-only.
Otherwise:

```sh
mongosh mongodb://127.0.0.1:27017 --quiet --eval 'db.adminCommand({listDatabases:1}).databases.map(d=>d.name).filter(n=>n.startsWith("horizon"))'
mongosh 'mongodb://127.0.0.1:27017/horizon:acct_2' --quiet --eval 'db.getCollectionNames()'
```

Names: database `horizon:acct_<accountId>`, collections `dg:row:file_<fileId>:acct_<accountId>`
and `dg:column:file_<fileId>:acct_<accountId>`. Usage counters live in `horizon:tracking`.

## Reset / demo data (ask the user first: it replaces their local data)

```sh
npm run db:reset          # drops Postgres horizon/horizon_logs + Mongo horizon*, re-migrates
npm run db:demo -- --yes  # loads ops/shared/dumps/demo (3 sample tables under demo@invokedb.com)
```
