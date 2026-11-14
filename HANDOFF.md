# InvokeDB revamp: handoff

_Last updated 2026-11-14_

InvokeDB (code name "horizon") is a roughly 6-year-old web app for building data tables that
you can query through an API. This revamp makes it run on a modern Mac with no Kubernetes. The
README covers day-to-day commands. This file covers where things stand, what changed and why,
the gotchas, and what to do next.

## Current state

|               |                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| `main`        | Local dev revamp, legacy-ops clean-up, secrets handling, demo data, backend upgrade. The only branch.     |
| Repo          | `stevehetz/invokedb` is **public** on purpose. History was scrubbed of secrets on 2026-11-14 (see below). |
| Runs locally? | Yes. `npm run dev` starts all three apps, and login, the API and Mongo writes work.                       |
| Production    | None. The Azure infrastructure was torn down. The scripts are kept for a later rebuild.                   |

### Apps

| Package                    | What                                                                                                   | Dev URL          |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------- |
| `packages/horizon-be`      | NestJS 11 API + websocket server. Postgres via TypeORM 0.3, MongoDB via the native `mongodb` 6 driver. | :8001 (ws :9000) |
| `packages/horizon-fe`      | Main app (Vue 2, Vue CLI 4, ag-grid, Element UI)                                                       | :8000            |
| `packages/horizon-auth-fe` | Marketing / login / signup / checkout (Vue 2)                                                          | :8005            |

Logins: `shetzel84@gmail.com` and `demo@invokedb.com` … `demo7@invokedb.com`, all with password `password`.

## Open items

None blocking. Stripe isn't in use, so the old Stripe keys are deliberately **not** being rolled.
If Stripe comes back, create new keys rather than reusing the originals in Dropbox
`secret/invokedb/stripe.env`.

### History scrub (2026-11-14)

The repo is public, so `git filter-repo` rewrote all of history and the result was force-pushed:

- Every version of `ops/shared/dumps/demo/postgres/horizon.bak` was replaced with the clean
  rebuilt dump. The old one had the Stripe live and test keys and a customer ID.
- `ops/azure-prod/azure-prod-build.values.sh` was removed from all commits. It had the Azure
  storage key, the file-share secret and the prod IPs. It now lives only in the Dropbox secret folder.
- The `cleanup-legacy-ops` and `local-dev-revamp` branches were deleted. Every commit SHA changed,
  so any other clone must be re-cloned, not pulled.
- A pre-scrub backup is in `~/dev/invokedb-pre-scrub-2026-11-14.bundle`. It contains the
  secrets, so never push it.
- `packages/horizon-be/src/constants.ts` still hardcodes `FS_TOKEN` / `WS_SERVER_TOKEN`. That's
  harmless with no deployment, but move them to env vars before deploying anywhere.

## What changed, and why

### Agent tooling + prettier (2026-11-14, merged)

- `AGENTS.md` is the shared agent instructions (commands, hard rules, conventions, gotchas).
  `CLAUDE.md` imports it with `@AGENTS.md` and adds the Claude-only notes.
- `.agents/` holds everything that isn't tied to one tool: `skills/` (`dev-stack`,
  `verify-backend`, `db-migration`) and `hooks/format-file.mjs`. `.claude/` is a thin shim,
  because Claude Code only reads its own folder: `settings.json` (the format hook) plus a
  `skills` symlink to `.agents/skills`.
- `.mcp.json`: Playwright MCP (`@playwright/mcp@0.0.84`, using your Chrome) for UI checks, and
  `mongodb-mcp-server@3.2.2` in `--readOnly` mode against local Mongo. Postgres goes through `psql`.
- **Prettier 3.9.10 at the root** with one `.prettierrc.json`. It keeps the old per-package
  styles (4 spaces, single quotes, no trailing commas, `arrowParens: avoid`, width 100, or 80 in
  `horizon-fe`), so prettier 3 itself changes very little. The per-package `prettier` keys and
  `format` scripts were removed, and the backend's direct prettier 1.19 dependency is gone. The
  frontends still have 1.19 inside `node_modules` through Vue CLI, so editors and hooks point at
  the root install. ESLint's `prettier/prettier` rule is off in both frontends, so that 1.19
  copy doesn't fight 3.x during `lintOnSave`.
- Format on save: `.vscode/settings.json` (root and per package), the workspace file, and
  `.editorconfig`. Claude Code formats every file it edits through the hook.
- `.prettierignore` skips `ops/` (Helm templates break), the backend email `.html` templates
  (whitespace shows up in the sent email) and the demo dumps.
- **One-off reformat of the whole repo** in its own commit (`style: format the repo with
prettier 3`), listed in `.git-blame-ignore-revs`. Locally, run
  `git config blame.ignoreRevsFile .git-blame-ignore-revs` so blame skips it. Both frontends
  and the backend built before and after the reformat. The compiled CSS is identical apart from
  whitespace and hex-color case.

### Backend upgrade (2026-11-14, merged)

Targets: **NestJS 7 → 11, TypeORM 0.2 → 0.3.31, `mongodb` driver 3.7 → 6, TypeScript 3.8 → 5.9**,
Express 4 → 5, `ws` 7 → 8, jest 25 → 29. Nest 12 and TypeORM 1.x exist now, but they're newer
than what this upgrade was validated against. Moving to them from here is a smaller, separate step.

- **Mongoose was never used.** The code talks to Mongo through the native driver, which it
  got transitively from mongoose. `mongoose` is gone and `mongodb` is a direct dependency.
- **Removed (unused or replaced):** `@nestjs/swagger`, `@nestjs/platform-ws`, `mongoose`,
  `mongodb-backup-4x`, `mongodb-restore` (plus the dead `backup_/restore_dg_row_collection`
  helpers), `request`, `mailgun-js` (now a plain `fetch` to the Mailgun HTTP API),
  `rimraf` (now `fs.rm`), `@types/mongodb`, and the unused `HttpModule` / `HttpService`.
- **TypeORM 0.3:** `findOne({...})` → `findOneBy`, `find({...})` → `findBy`, `count` →
  `countBy`, `findByIds` → `findBy({ id: In(...) })`, `getManager()` → injected `DataSource`.
  The CLI now uses `src/database/data-source.ts`. `_ormconfig.ts` is the one config shared by the app and the CLI.
- **`invalidWhereValuesBehavior: throw`** is set for `null` and `undefined`. TypeORM 0.3 silently
  drops `undefined` from find conditions, so `findOneBy({ token: undefined })` would return
  the _first session in the table_. Now it throws. Lookups where a missing value is a normal
  input (`authorize`/`logout` without a token, login/reset/signup without an email, API-key
  and Stripe-customer lookups) return early with the old response instead.
- **`subscription.price` is now `@Column({ type: 'decimal' })`.** 0.3 `parseInt`s a bare
  `number` column, which turned `"99.99"` into `99`.
- **mongodb 6:** `res.ops` → `insertedId`, cursor `.count()` → `countDocuments`,
  `findOneAndUpdate` uses `returnDocument: 'after', includeResultMetadata: true` (same
  response shape as before), and one `MongoClient` per URI instead of one per database. The
  column-type conversion loop now awaits its bulk writes and skips empty batches. Before, it
  fired them without waiting and swallowed errors.
- **Express 5:** `main.ts` sets `query parser` to `extended` so `sort[a]=desc` style query
  strings still parse.
- **How it was verified:** `scripts/api-smoke.mjs` ran about 30 API calls (login, CSV upload + processing,
  grid reads with filters, row and column updates, type conversion with an index, the external
  `/api/v1` CRUD with an API key, column and table delete, logout) against the old and new
  backends on throwaway databases. The responses were diffed and are identical apart from
  auto-increment IDs. Also checked: signup → reset password → change password → login, a
  websocket round-trip, all 9 migrations from scratch, `migration:revert` / `run` / `create`,
  and `tsc` build + `node dist/main.js`.

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
  - `mongoose` → 5.13 (later removed in the backend upgrade).
  - The native Postgres log transport (`@pauleliet/winston-pg-native`) is now an optional
    dependency that's skipped when it isn't installed.
- **Mailgun and Slack are optional.** Without keys, emails and support requests go to the
  backend log. Before, a failed email threw an error inside a callback and crashed the server.
- The Google Fonts webpack plugin was broken (its API is gone), so it was replaced with a
  `<link>` tag in each `public/index.html`.
- Babel packages were updated to fix a version mismatch from the old lockfile.
- Vue CLI 4 / webpack 4 need `NODE_OPTIONS=--openssl-legacy-provider`. `env.sh` sets it.

### From `cleanup-legacy-ops` (merged)

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

1. **Frontend upgrade:** Vue 2 → Vue 3 + Vite. This is the biggest job. Element UI → Element
   Plus, `ag-grid-vue` → `ag-grid-vue3`, and jQuery / jqtree in `h-tree` should go.
   Consider merging `horizon-auth-fe` into `horizon-fe`.
2. **Optional:** a `docker-compose.yml` for Postgres and Mongo, so the app doesn't depend on
   whatever is installed locally.
3. **Before redeploying anywhere:** update the Dockerfiles and decide whether to keep the
   AKS/Helm setup or move to something simpler (a single VM, Fly, Render, and so on).
4. **Backend follow-ups (optional):** Nest 12 / TypeORM 1.x, `stripe` 8 → current (only if
   Stripe comes back), replace `tslint` with ESLint, and work through `npm audit` (15 issues,
   mostly dev tooling).

## Key files

| File                                             | Purpose                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `scripts/env.sh`                                 | Loads `.env` and sets `HORIZON_ROOT` and `NODE_OPTIONS`                  |
| `scripts/dev.sh`                                 | Starts all three apps                                                    |
| `scripts/setup.sh`                               | First-time install + secrets pull + DB setup                             |
| `scripts/db-setup.sh`                            | Creates the DBs and runs migrations (`--reset` to drop `horizon*` first) |
| `scripts/db-demo.sh`                             | Loads the demo dataset                                                   |
| `scripts/secrets.sh`                             | Copies secret files to and from the Dropbox secret folder                |
| `scripts/be-run.sh`                              | Runs a backend npm script with `.env` loaded (used for migrations)       |
| `packages/horizon-be/src/env.ts`                 | Every env var the backend reads                                          |
| `packages/horizon-be/src/database/_ormconfig.ts` | TypeORM options shared by the app and the CLI (`data-source.ts`)         |
| `packages/horizon-be/src/database/migration/`    | TypeORM migrations, including seed and test data                         |
