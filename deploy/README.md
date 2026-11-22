# Production deploy (one server)

Everything runs on one DigitalOcean droplet with `docker compose`: Caddy (TLS + the built
frontend), the API (HTTP, websocket broker, uploads), the CSV processor in its own container,
Postgres and Mongo. Only Caddy publishes ports. The images are built on the server from the
committed `HEAD`, so the Mac needs no Docker. `deploy.sh` drives it all over SSH.

| Host               | Serves                                 |
| ------------------ | -------------------------------------- |
| `invokedb.com`     | Public site at `/`, app at `/app`      |
| `api.invokedb.com` | Backend routes and `/api/v1`           |
| `ws.invokedb.com`  | Websocket broker (browser connections) |

The backend gets its own hosts because its routes sit at the root, where they'd clash with the
site's paths.

## First deployment

1. **Droplet:** Ubuntu 24.04, NYC, Basic 2 vCPU / 4 GB (resize to 8 GB if it struggles, and
   raise `MONGO_CACHE_GB` and `PRC_CPUS`), your SSH key, backups on.
2. **Cloud Firewall** on the droplet: inbound TCP 80 and 443 (and UDP 443 for HTTP/3) from
   anywhere, TCP 22 from your IP only.
3. **Cloudflare DNS**, DNS-only (grey cloud): A records `@`, `www`, `api` and `ws` to the
   droplet's IPv4. Caddy can't get certificates until these resolve.
4. `deploy/deploy.sh init-env`, then set `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `ACME_EMAIL` in
   `deploy/prod.env`, and `npm run secrets:push` so it's backed up with the other secrets.
5. `deploy/deploy.sh bootstrap`: installs Docker, adds swap, turns off SSH passwords.
6. Commit, then `deploy/deploy.sh up`: ships `HEAD`, builds both images, runs the migrations
   and starts everything.
7. `deploy/deploy.sh init-db`, **once**: the migrations seed demo accounts whose password and
   API keys are in this public repo, and this gives them random ones.
8. Check `https://invokedb.com`, sign up, upload a CSV.

## Day to day

- `deploy/deploy.sh up` deploys the committed `HEAD` (uncommitted changes aren't shipped).
  Migrations run before the containers restart.
- `deploy/deploy.sh logs [api|prc|web|postgres|mongo]`, `ps`, `ssh`, or
  `compose <any docker compose args>`.
- Without Mailgun, emails (welcome, password reset links) are printed in `logs api`. That's
  also how to get back into a seeded account after `init-db`: request a reset and copy the link.

## Notes

- Data lives in named Docker volumes (`pg_data`, `mongo_data`, `files`, `caddy_data`). Removing
  them (`docker compose down -v`) deletes the database.
- Mongo runs standalone with auth. The app user (`horizon`) is created by `mongo-init.js` the
  first time the volume is initialised, so changing `MONGO_APP_PASSWORD` later needs the
  change made in Mongo too. Same for `POSTGRES_PASSWORD`.
- Changing the domains needs only `prod.env` and an `up`: the browser's runtime env
  (`/env.txt`) is written from them when the web container starts.
- **Not done yet:** off-site backups (Postgres and Mongo dumps to object storage, with an alert
  on missed runs and a tested restore) and uptime monitoring. Until then the only backups are
  the droplet's.
