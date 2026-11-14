---
name: verify-backend
description: Verify a horizon-be (NestJS) change by building it and diffing API smoke-test responses from before and after the change, using throwaway databases. Use after any backend change that could affect behaviour (services, entities, queries, dependency upgrades, Express/Nest config), and before saying a backend change works.
---

# Verify a backend change

There are no meaningful unit tests. The evidence that a change is safe is: **it compiles**, and
**the API answers the same way before and after** (or differs only where you meant it to).

## 1. Compile and lint

```sh
npm --prefix packages/horizon-be run build    # tsc -p tsconfig.build.json; must be clean
npm --prefix packages/horizon-be run lint     # tslint; don't add new errors
```

## 2. Throwaway environment (never smoke-test against the user's real data)

`scripts/api-smoke.mjs` creates and deletes a table under `demo@invokedb.com`. Run it against
separate databases on separate ports, so it can't touch real data or collide with a running
`npm run dev`:

```sh
S=<scratch dir>
bash scripts/smoke-env.sh "$S/smoke.env"   # DBs horizon_smoke*, ports be 8101 / ws 9100 (+ fe 8100 / auth 8105)
```

The same env file serves the `verify-frontend` UI smoke test, so one throwaway stack covers both.

Create the DBs and run the migrations, which seed the demo accounts:

```sh
HORIZON_ENV_FILE="$S/smoke.env" bash scripts/db-setup.sh
```

> ⚠️ **Never** run `db-setup.sh --reset` or `db-demo.sh` with the smoke env. Their Mongo drop
> filters on the `horizon` prefix, not on the configured DB name, so they would wipe the user's
> real `horizon*` databases too.

## 3. Baseline, then the change

```sh
# Baseline: the code before your change (stash it, or use `git worktree add` on the base commit)
HORIZON_ENV_FILE="$S/smoke.env" bash -c 'source scripts/env.sh && npm --prefix packages/horizon-be start'   # background
node scripts/api-smoke.mjs http://127.0.0.1:8101 "$S/before.json"      # every line should say "ok"
# stop the backend, apply your change, start it again the same way, then:
node scripts/api-smoke.mjs http://127.0.0.1:8101 "$S/after.json"
diff <(jq -S . "$S/before.json") <(jq -S . "$S/after.json")
```

Differences you can expect: auto-increment IDs, file IDs, tokens and timestamps. Anything else
is a behaviour change. Explain it, or fix it.

If your change touches endpoints the smoke script doesn't call, add calls to
`scripts/api-smoke.mjs` (keep it self-cleaning) rather than checking by hand once.

## 4. Other checks, depending on the change

- Entities or migrations: see the `db-migration` skill (run from scratch, revert, run).
- Websocket (`src/websocket`, `src/web/ws`): connect to `ws://127.0.0.1:9100` and do a round trip.
- Production build: `npm --prefix packages/horizon-be run build && node packages/horizon-be/dist/main.js`
  with the smoke env loaded.

## 5. Clean up only the throwaway data

```sh
PGHOST=127.0.0.1 PGUSER=postgres psql -d postgres -c 'DROP DATABASE IF EXISTS horizon_smoke WITH (FORCE)' -c 'DROP DATABASE IF EXISTS horizon_smoke_logs WITH (FORCE)'
mongosh mongodb://127.0.0.1:27017 --quiet --eval 'db.adminCommand({listDatabases:1}).databases.filter(d=>d.name.startsWith("horizon_smoke")).forEach(d=>db.getSiblingDB(d.name).dropDatabase())'
rm -rf .data/smoke
```

Report the results as they are: say which checks ran and paste any non-trivial diff.
