# InvokeDB

Monorepo with three apps:

| Package                    | What                                               | Dev URL                          |
| -------------------------- | -------------------------------------------------- | -------------------------------- |
| `packages/horizon-be`      | NestJS API + websocket server (Postgres + MongoDB) | http://127.0.0.1:8001 (ws :9000) |
| `packages/horizon-fe`      | Main app (Vue 2)                                   | http://127.0.0.1:8000            |
| `packages/horizon-auth-fe` | Marketing / login / signup / checkout (Vue 2)      | http://127.0.0.1:8005            |

## Prerequisites

- Node 22 (`nvm use`)
- PostgreSQL on `127.0.0.1:5432` (Postgres.app or `brew install postgresql`)
- MongoDB on `127.0.0.1:27017` (`brew install mongodb-community`) plus `mongosh`

You don't need Docker, Kubernetes, tmux, or the Stripe CLI for local dev.

## First run

```
npm run setup     # installs all packages, creates .env, creates DBs, runs migrations
npm run dev       # starts backend + both frontends; Ctrl-C stops all
```

Open http://127.0.0.1:8005 and log in:

```
username: shetzel84@gmail.com   (or demo2@invokedb.com … demo7@invokedb.com)
password: password
```

> **Postgres.app users:** the first time the backend connects, Postgres.app shows a
> permission dialog for `node`. Click **OK**, or the connection fails after 60s.
> You can turn this off in Postgres.app → Settings.

## Config and secrets

All config lives in `.env` at the repo root, created from `.env.example`. Mailgun, Slack and
Stripe are optional. Without keys, emails and support requests are printed to the backend log.

Secret files (`.env`, the Azure `*.values.sh` files, SSH keys) are gitignored. The originals
live in the Dropbox folder `secret/invokedb`, and you copy them back and forth:

```
npm run secrets:status   # which copies differ
npm run secrets:pull     # Dropbox secret folder -> repo (npm run setup does this)
npm run secrets:push     # repo -> Dropbox secret folder, after editing .env etc.
```

Neither direction overwrites a newer file unless you pass `-- --force`.
Set `INVOKEDB_SECRET_DIR` to use a different folder.

## Database

```
npm run db:setup                    # create missing DBs + run pending migrations (safe)
npm run db:reset                    # drop + recreate InvokeDB's DBs only (Postgres horizon*, Mongo horizon*)
npm run db:demo                     # replace local data with the demo dataset (asks first)
npm run migration:create -- Name    # new TypeORM migration
```

The demo dataset (`ops/shared/dumps/demo`) has three sample tables under `demo@invokedb.com`.

## Formatting

One root prettier 3 config (`.prettierrc.json`) covers the whole repo.

```
npm run format          # format everything
npm run format:check    # check only
```

VS Code formats on save (`.vscode/settings.json`; install the recommended Prettier extension).
It's pointed at the root prettier, because the frontends carry an older prettier 1.19 inside
`node_modules`.

Staged files are also formatted when you commit (`.githooks/pre-commit`). `npm install` at the
root turns this on by setting `git config core.hooksPath .githooks`.

## Coding agents

`AGENTS.md` holds the instructions for any coding agent, and `CLAUDE.md` just imports it.
Agent playbooks ("skills") are in `.agents/skills`, and `AGENTS.md` says when to read each one.
`.mcp.json` adds Playwright (browser) and a read-only MongoDB MCP server.

## Versioning

```
npm run push "your commit message"  # bumps the patch version everywhere, commits, tags, pushes
```

## Production (Azure, currently torn down)

`ops/azure-*` and `npm run prod:*` build and deploy to Azure AKS. They aren't used for local
dev and haven't been run since the infrastructure was deleted, so expect to update them
before deploying again.
