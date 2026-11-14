# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Cursor, etc.) working in this repo.
Humans: see `README.md` for commands and `HANDOFF.md` for project status and history.

## What this is

InvokeDB (code name "horizon"): a web app for building data tables you can query through an
API. A monorepo of three apps with **separate `node_modules`** (no npm workspaces):

| Package                    | Stack                                                                | Dev URL                 |
| -------------------------- | -------------------------------------------------------------------- | ----------------------- |
| `packages/horizon-be`      | NestJS 11, TypeORM 0.3 (Postgres), native `mongodb` 6 driver, `ws` 8 | :8001 (websocket :9000) |
| `packages/horizon-fe`      | Main app: Vue 2, Vue CLI 4, ag-grid, Element UI, Vuex                | :8000                   |
| `packages/horizon-auth-fe` | Marketing / login / signup / checkout: Vue 2                         | :8005                   |

Logins (local and demo data): `demo@invokedb.com` … `demo7@invokedb.com`, password `password`.

## Commands

Run from the repo root. Every script loads `.env` through `scripts/env.sh`.

```sh
npm run dev                  # all three apps (concurrently); Ctrl-C stops all
npm run db:setup             # create missing DBs + run pending migrations (safe)
npm run migration:create -- Name
npm run migration:run | migration:revert
npm run format               # prettier --write . (root prettier 3)
npm run format:check
npm --prefix packages/horizon-be run build   # tsc: the main backend correctness check
npm --prefix packages/horizon-be run lint    # tslint
node scripts/api-smoke.mjs [base_url] [out.json]  # ~30 API calls against a running backend
```

There are no unit tests worth running yet (jest is configured, but there are no specs). Verify
backend changes with `build` plus `api-smoke.mjs` (see the `verify-backend` skill). Verify UI
changes in a browser (the Playwright MCP server).

## Hard rules

- **The GitHub repo is public.** Never commit secrets, keys, tokens, customer data or real
  connection strings. Secret files (`.env`, `ops/**/*.values.sh`, SSH keys) are gitignored, and
  their originals live in a Dropbox folder that `scripts/secrets.sh` syncs. Never add a secret
  file to git, never weaken `.gitignore`, and never push `~/dev/invokedb-pre-scrub-*.bundle`.
- **Don't run `npm run prod:*`, `base:construct` or anything under `ops/azure-*`.** That
  infrastructure is torn down, and the scripts target real Azure resources.
- **Destructive DB commands need the user's OK first:** `db:reset`, `db:demo`,
  `migration:revert`, and any `DROP` / `dropDatabase`. They only touch `horizon*` databases, but
  that is still the user's local data. For experiments, use throwaway DBs through
  `HORIZON_ENV_FILE` (see `verify-backend`).
- **No native (C/C++) npm packages.** The Xcode command-line tools on this Mac are broken, so
  anything with `node-gyp` fails to install. Install the backend with `--omit=optional`.
- **Don't run `npm run push`** (it bumps versions, tags and pushes) unless asked.
- Don't commit or push unless asked. Branch first if on `main`.

## Formatting

- One root prettier 3 (`.prettierrc.json`, `.prettierignore`): 4-space indent, single quotes,
  no trailing commas, `arrowParens: avoid`, print width 100 (80 in `horizon-fe`).
- **Claude Code formats every file it edits automatically** (PostToolUse hook →
  `.agents/hooks/format-file.mjs`). Other agents: run `node .agents/hooks/format-file.mjs <files>`
  after editing, or `npm run format`.
- Always use the **root** prettier. The frontends have prettier 1.19 inside `node_modules`
  (pulled in by Vue CLI), and it formats differently.
- `ops/` and the backend email `.html` templates are intentionally not formatted.

## Backend conventions (`packages/horizon-be`)

- Layout: `src/web/http/*` controllers → `src/application/*` services → `src/core/*` managers
  and entities. `src/core/mongodb/collections.ts` names the Mongo databases and collections.
  `src/env.ts` lists every env var the backend reads.
- Import alias `@app/*` → `src/*`.
- Code style is `snake_case` for variables, methods and DB columns. Match the code around you.
- **TypeORM 0.3:** use `findOneBy`/`findBy`/`countBy`, `In(...)`, and an injected `DataSource`
  (never `getManager()`). `invalidWhereValuesBehavior` throws on `null`/`undefined` in where
  clauses, so check for missing input and **return early** instead of querying with it.
- Decimal columns need `@Column({ type: 'decimal' })`, or 0.3 `parseInt`s them.
- **Mongo** uses the native driver (no mongoose). There is one database per account,
  `horizon:acct_<id>`, with grid collections such as `dg:row:file_<fileId>:acct_<id>` and
  `dg:column:...`, plus `horizon:tracking`. Await bulk writes and skip empty batches.
- In local mode one process runs all four backend roles (`IS_HORIZON_BE`, `_PRC`, `_SB`, `_FS`).
- Migrations live in `src/database/migration/`. Never edit a migration that has already shipped.
  Add a new one (see the `db-migration` skill).
- Express 5 with `query parser: extended`, so query strings like `sort[a]=desc` parse.

## Frontend conventions (`horizon-fe`, `horizon-auth-fe`)

- Vue 2 Options API. Components are often split into `index.vue` + `<name>.html` (template, via
  `<template src>`) + `<name>.js` + `.scss`. Keep that split when editing an existing component.
- Vue CLI 4 / webpack 4 need `NODE_OPTIONS=--openssl-legacy-provider`, which `env.sh` sets. Use
  the npm scripts instead of calling `vue-cli-service` directly.
- A Vue 3 + Vite migration is planned next (see `HANDOFF.md`). Avoid new Vue-2-only patterns
  such as filters, `$listeners`, `Vue.set` or event-bus additions when there's a neutral
  alternative.

## Gotchas

- **Postgres.app permission dialog:** the first connection from a new client app needs a click.
  If the backend is started without a terminal, it fails after 60s with `failed to verify
"trust" authentication`. Ask the user to start `npm run dev` in their own terminal if that
  happens.
- Stripe keys are read once, by the Initial migration, into the `stripe_env` table.
- Mailgun and Slack are optional. Without keys, emails go to the backend log.

## Skills and tools for agents

Shared skills live in `.agents/skills/<name>/SKILL.md` (`.claude/skills` is a symlink to it):

- `dev-stack`: start, check and stop the local stack; inspect Postgres and Mongo.
- `verify-backend`: prove a backend change didn't alter API behaviour (build + smoke diff).
- `db-migration`: create, run and revert TypeORM migrations safely.

MCP servers (`.mcp.json`):

- `playwright`: drive Chrome to check UI changes at http://127.0.0.1:8005 → :8000.
- `mongodb`: **read-only** access to local Mongo (`horizon*` databases).

Postgres has no MCP server. Use `psql` (`PGHOST=127.0.0.1 PGUSER=postgres psql horizon`).

Keep this file current. If you learn something a future agent would trip over, add it here
(briefly) or to the relevant skill.
