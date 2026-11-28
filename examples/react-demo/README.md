# Support desk (React example)

A small support desk built with React on InvokeDB, live at
<https://examples.invokedb.com/react-demo>. It shows what an app on the API looks like:

- **Tickets** with filters (status, priority, customer) and search, through
  `POST /api/v1/query` (filters, sort, cursor paging) and `/count`.
- A **board** (kanban) of tickets by status; dragging a card is one `PUT /api/v1/update`.
- A **ticket page**: the linked customer (`expand=customer`), its comments (a filter on the
  Comments table's link column), adding a comment, changing status and priority.
- A **New ticket** form (`POST /api/v1/create`, the customer as a link cell).
- A **live activity feed**: an InvokeDB webhook on every row change, from this app, the grid or
  the API, reaches the browser within a few seconds.

Three tables, linked: **Customers** (from `examples/data/contacts.csv`), **Tickets** (number,
title, description, status, priority, created, link to Customers) and **Comments** (body,
author, created, link to Tickets). `server/schema.mjs` defines them.

## How it fits together

```
browser ──/react-demo/api/*──▶ server/ ──Bearer key──▶ InvokeDB /api/v1
browser ◀──/react-demo/events (SSE)── server/ ◀──POST /react-demo/webhook── InvokeDB webhooks
```

- `src/`: the React app (Vite + TypeScript). It uses the `invokedb` client
  (`examples/invokedb-node`, imported as source) against the server's `/api`, so it never
  holds a key.
- `server/`: a Node server with no dependencies (`node:http`). It
  - holds the demo account's read-write API key and passes on only the calls the app makes
    (`proxy.mjs`: query/count on the three tables, creating tickets and comments, updating a
    ticket's status, priority, title or description; one row at a time, checked), with per-IP
    rate limits (`rate-limit.mjs`) and a 16 KB body limit;
  - receives InvokeDB's webhooks at `POST /webhook`, checks the `InvokeDB-Signature` header
    (HMAC-SHA256 of `<t>.<raw body>`, timestamps older than 5 minutes refused; `signature.mjs`),
    and sends each change to every browser over server-sent events (`GET /events`,
    `events.mjs`);
  - resets the data to the seed set every night (`reset.mjs`, 04:00 UTC by default), and on
    `SIGUSR2` or `npm run reset`;
  - serves the built app (`dist/`).
- `seed/`: `generate.mjs` writes `seed.json` (the same on every run, invented data).
- `setup.mjs`: the one-time setup of the demo's account (below).

## Run it locally

With the backend running (`npm run dev` at the repo root):

```sh
cd examples/react-demo
npm install
INVOKEDB_PASSWORD=password node setup.mjs --email demo2@invokedb.com \
    --webhook-url https://example.com/webhook   # a local URL is refused as a webhook target
# copy the printed REACT_DEMO_API_KEY:
INVOKEDB_API_KEY=... RESET_HOUR_UTC=off npm run server   # :8080
npm run dev                                              # :5174/react-demo/, proxies to :8080
```

InvokeDB refuses webhook URLs on private addresses, so the live feed only works locally if the
server is reachable from the internet (a tunnel) and the webhook points there; everything else
works without it. `npm run build && npm start` serves the built app from the server instead.

Settings (environment): `INVOKEDB_BASE_URL` (default `http://127.0.0.1:8001/api/v1`),
`INVOKEDB_API_KEY`, `INVOKEDB_WEBHOOK_SECRET`, `PORT` (8080), `BASE_PATH` (`/react-demo`),
`RESET_HOUR_UTC` (4, or `off`), `TRUST_PROXY` (`1` behind Caddy).

## Checks

```sh
npm run lint    # ESLint, and tsc over the server's JavaScript
npm test        # the server's unit tests (node --test)
npm run build   # tsc + vite build
```

## Production

The `react-demo` service in `deploy/compose.yaml` (see `deploy/README.md`, "Example apps").
`setup.mjs` is run once against production as the demo's own internal account:

```sh
INVOKEDB_PASSWORD=... node examples/react-demo/setup.mjs \
    --base https://api.invokedb.com --email <demo account> [--code <2FA code>]
```

It makes the three tables (types, indexes, links), a read-write key for them only, the seed
rows and a webhook to `https://examples.invokedb.com/react-demo/webhook`, then prints
`REACT_DEMO_API_KEY` and `REACT_DEMO_WEBHOOK_SECRET` for `deploy/prod.env`. `--replace` deletes
and re-creates the tables.

This folder keeps its own prettier style (2 spaces, in `package.json`) and is listed in the
root `.prettierignore`.
