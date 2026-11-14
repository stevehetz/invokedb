# InvokeDB

Monorepo with three apps:

| Package | What | Dev URL |
|---|---|---|
| `packages/horizon-be` | NestJS API + websocket server (Postgres + MongoDB) | http://127.0.0.1:8001 (ws :9000) |
| `packages/horizon-fe` | Main app (Vue 2) | http://127.0.0.1:8000 |
| `packages/horizon-auth-fe` | Marketing / login / signup / checkout (Vue 2) | http://127.0.0.1:8005 |

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

## Config
All config lives in `.env` at the repo root, created from `.env.example`. Mailgun, Slack and
Stripe are optional. Without keys, emails and support requests are printed to the backend log.

## Database
```
npm run db:setup                    # create missing DBs + run pending migrations (safe)
npm run db:reset                    # drop + recreate InvokeDB's DBs only (Postgres horizon*, Mongo horizon*)
npm run migration:create -- Name   # new TypeORM migration
```

## Versioning
```
npm run push "your commit message"
```

## Legacy
`ops/` holds the old minikube/Helm local setup and the Azure/AKS production scripts
(`npm run prod:*`). Local dev doesn't use them.
