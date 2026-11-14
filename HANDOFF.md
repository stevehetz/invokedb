# InvokeDB revamp: handoff

_Last updated 2026-11-14_

InvokeDB (code name "horizon") is a roughly 6-year-old web app for building data tables that
you can query through an API. This revamp makes it run on a modern Mac with no Kubernetes. The
README covers day-to-day commands. This file covers where things stand, what changed and why,
the gotchas, and what to do next.

## Current state

| | |
|---|---|
| `main` | `f58937d`: local dev revamp (Node 22, no minikube). Pushed. |
| `cleanup-legacy-ops` | Clean-up + secrets handling + demo data. **Not committed yet.** See below. |
| Runs locally? | Yes. `npm run dev` starts all three apps, and login, the API and Mongo writes work. |
| Production | None. The Azure infrastructure was torn down. The scripts are kept for a later rebuild. |

### Apps
| Package | What | Dev URL |
|---|---|---|
| `packages/horizon-be` | NestJS 7 API + websocket server. Postgres via TypeORM 0.2, MongoDB via Mongoose 5. | :8001 (ws :9000) |
| `packages/horizon-fe` | Main app (Vue 2, Vue CLI 4, ag-grid, Element UI) | :8000 |
| `packages/horizon-auth-fe` | Marketing / login / signup / checkout (Vue 2) | :8005 |

Logins: `shetzel84@gmail.com` and `demo@invokedb.com` … `demo7@invokedb.com`, all with password `password`.

## Open items (do these first)

1. **Roll the Stripe live secret key** in the Stripe Dashboard → Developers → API keys, unless
   that account is closed. The key was committed inside the demo DB dump
   (`ops/shared/dumps/demo/postgres/horizon.bak`, commit `3fed1e0`), and `stevehetz/invokedb`
   is a **public** repo. The current files are clean, but git history
   still has the key. Rolling the key is the fix. Optionally scrub history afterwards
   (`git filter-repo` + force push).
   The original keys are in Dropbox `secret/invokedb/stripe.env`.
2. **Commit `cleanup-legacy-ops`** and merge it to `main`.
3. Possibly consider making the repo private.

The Azure Storage key that was also in history is harmless, because that storage account no
longer exists.

## What changed, and why

### On `main` (local dev revamp)
- **No minikube, Helm or tmux.** The app uses your local Postgres (Postgres.app) and MongoDB.
  `scripts/dev.sh` runs all three apps through `concurrently`.
- **One `.env` file** at the repo root, created from `.env.example` and loaded by
  `scripts/env.sh`. The old scripts that wrote variables into `~/.bash_profile` are gone.
- **Safe DB scripts** (`scripts/db-setup.sh`). The old `setupdbs` dropped **every** Mongo
  database on the machine. The new `db:reset` only touches `horizon*`.
- **Dependencies swapped for Node 22 / arm64:**
  - `bcrypt` → `bcryptjs`. Existing hashes still verify.
  - `node-sass` → `sass`.
  - `pg` 7 → 8, because version 7 hangs on Node 14+.
  - `mongoose` → 5.13.
  - The native Postgres log transport (`@pauleliet/winston-pg-native`) is now an optional
    dependency that's skipped when it isn't installed.
- **Mailgun and Slack are optional.** Without keys, emails and support requests go to the
  backend log. Before, a failed email threw an error inside a callback and crashed the server.
- The Google Fonts webpack plugin was broken (its API is gone), so it was replaced with a
  `<link>` tag in each `public/index.html`.
- Babel packages were updated to fix a version mismatch from the old lockfile.
- Vue CLI 4 / webpack 4 need `NODE_OPTIONS=--openssl-legacy-provider`. `env.sh` sets it.

### On `cleanup-legacy-ops` (uncommitted)
- Deleted `ops/local/`, `docs/ops/ops-local.md`, `docs/ops/ops-minikube.md`,
  `workspaces/horizon-sh-mac.code-workspace` (stale absolute paths) and `lerna.json`.
- **Secrets are copied instead of symlinked.** `scripts/secrets.sh` (`npm run secrets:pull`,
  `secrets:push`, `secrets:status`) copies the files between the repo and Dropbox
  `secret/invokedb`. It covers `.env`, the Azure `*.values.sh` files and the prod SSH keys.
  - It refuses any file that isn't gitignored.
  - It won't overwrite a newer file without `-- --force`.
  - `npm run setup` pulls automatically.
- `ops/azure-prod/azure-prod-build.values.sh` is no longer tracked by git. It lives in the
  secret folder with the others.
- **Demo data:** the dump in `ops/shared/dumps/demo` was rebuilt without the Stripe keys,
  customer IDs or session tokens. `npm run db:demo` loads it and asks first, because it
  replaces local data.
- `push.sh` no longer needs lerna. It bumps the patch version in all `package.json` files,
  then commits, tags `vX.Y.Z` and pushes. It hasn't been run yet.
- `scripts/env.sh` accepts `HORIZON_ENV_FILE=<path>` to point at an alternate env file. That's
  how `db:demo` was tested against throwaway databases.

## Gotchas

- **The Xcode command-line tools on this Mac are broken** (`make` crashes), so any npm package
  that compiles C code fails to install. Fix with `xcode-select --install` or an Xcode update.
  Until then, avoid native packages. This is why the backend installs with `--omit=optional`.
- **Postgres.app's permission dialog.** Postgres.app uses `trust` auth and asks the first time
  a new client app connects. If nobody clicks OK, the backend fails after 60s with
  `Postgres.app failed to verify "trust" authentication`. This happens when the process isn't
  attached to a terminal, for example `(npm run dev &)` in a subshell. Run it from a normal
  terminal, or turn the check off in Postgres.app → Settings.
- **Stripe keys are read once.** The Initial migration reads `STRIPE_*` from the environment
  and stores them in the `stripe_env` table. Set them in `.env` before running `db:setup`, or
  update that table afterwards.
- Mongo uses one database per account (`horizon:acct_<id>`) plus `horizon:tracking`.
- In local mode the backend runs all four roles in one process (`IS_HORIZON_BE`, `_PRC`, `_SB`,
  `_FS`). Production ran them as separate pods.
- `docs/ops-standalone.md` is an old to-do list. The minikube, Mailgun, Slack and Stripe parts
  are now done, or optional.

## Not yet tested
- Full UI flows in a browser, beyond what was checked by hand: CSV upload, the data grid,
  websocket updates, the API key page.
- Stripe checkout.
- `push.sh`.
- Production Docker images. The Dockerfiles still use `node:10` and will need updating.

## Suggested next steps
1. **Backend upgrade:** NestJS 7 → 10, TypeORM 0.2 → 0.3 (the DataSource API changes),
   Mongoose 5 → 8, TypeScript 3.8 → 5. Mostly mechanical. Replace `mailgun-js` (deprecated) and
   `request`.
2. **Frontend upgrade:** Vue 2 → Vue 3 + Vite. This is the biggest job. Element UI → Element
   Plus, `ag-grid-vue` → `ag-grid-vue3`, and jQuery / jqtree in `h-tree` should go.
   Consider merging `horizon-auth-fe` into `horizon-fe`.
3. **Optional:** a `docker-compose.yml` for Postgres and Mongo, so the app doesn't depend on
   whatever is installed locally.
4. **Before redeploying anywhere:** update the Dockerfiles and decide whether to keep the
   AKS/Helm setup or move to something simpler (a single VM, Fly, Render, and so on).

## Key files
| File | Purpose |
|---|---|
| `scripts/env.sh` | Loads `.env` and sets `HORIZON_ROOT` and `NODE_OPTIONS` |
| `scripts/dev.sh` | Starts all three apps |
| `scripts/setup.sh` | First-time install + secrets pull + DB setup |
| `scripts/db-setup.sh` | Creates the DBs and runs migrations (`--reset` to drop `horizon*` first) |
| `scripts/db-demo.sh` | Loads the demo dataset |
| `scripts/secrets.sh` | Copies secret files to and from the Dropbox secret folder |
| `scripts/be-run.sh` | Runs a backend npm script with `.env` loaded (used for migrations) |
| `packages/horizon-be/src/env.ts` | Every env var the backend reads |
| `packages/horizon-be/src/database/migration/` | TypeORM migrations, including seed and test data |
