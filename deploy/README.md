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
- Email goes out through Mailgun (`MAILGUN_API_KEY`, `MAILGUN_DN=mail.invokedb.com`, US region,
  free plan). The sending domain's SPF and DKIM records are in Cloudflare, plus a
  `_dmarc.invokedb.com` record (`p=none`). Without a key, emails are printed in `logs api`.
- Contact-form requests go to Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). To set it
  up: message `@BotFather`, send `/newbot` and copy the token; send your new bot any message,
  then open `https://api.telegram.org/bot<token>/getUpdates` and copy `message.chat.id`.
  Without them (or the Slack support webhook), requests are only written to `logs api`.
- To get into a seeded account after `init-db`, request a password reset. `invokedb.com` has no
  MX records (by choice), so resets for the `demo*@invokedb.com` accounts bounce.
- The SSH key (`~/.ssh/invokedb`) is synced to Dropbox by `npm run secrets:push`/`pull`, so any
  Mac with the secrets can deploy.

## Notes

- Data lives in named Docker volumes (`pg_data`, `mongo_data`, `files`, `caddy_data`). Removing
  them (`docker compose down -v`) deletes the database.
- Mongo runs standalone with auth. The app user (`horizon`) is created by `mongo-init.js` the
  first time the volume is initialised, so changing `MONGO_APP_PASSWORD` later needs the
  change made in Mongo too. Same for `POSTGRES_PASSWORD`.
- Changing the domains needs only `prod.env` and an `up`: the browser's runtime env
  (`/env.txt`) is written from them when the web container starts.
- **Not done yet:** uptime monitoring.

## Backups

`deploy/backup.sh` runs on the server. Every night at 07:15 UTC, cron dumps Postgres
(`pg_dump -Fc`) and Mongo (`mongodump --archive --gzip`), encrypts both with
`BACKUP_PASSPHRASE`, and uploads them to a Backblaze B2 bucket as `<stamp>/` with a
`manifest.txt` of checksums. Each run pings Healthchecks.io, which emails you if a night is
missed or fails. The uploaded files in the `files` volume aren't backed up: they're temporary,
kept only until the CSV processor has loaded them into Mongo. DigitalOcean's weekly droplet
backup is still on as a second copy.

Setup, once:

1. **Backblaze B2:** create a private bucket (e.g. `invokedb-backups`) with default encryption
   on, and a lifecycle rule that keeps files for 30 days (Lifecycle Settings → custom:
   `daysFromUploadingToHiding: 30`, `daysFromHidingToDeleting: 1`). Then create an
   application key restricted to that bucket, with read and write access.
2. **Healthchecks.io:** add a check with a 1-day period and a 2-hour grace, and copy its ping
   URL.
3. In `deploy/prod.env` set `BACKUP_S3_ENDPOINT` (the bucket's endpoint, e.g.
   `https://s3.us-east-005.backblazeb2.com`), `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID` (the
   keyID), `BACKUP_S3_SECRET` (the applicationKey) and `HEALTHCHECK_URL`, then run
   `npm run secrets:push`. `BACKUP_PASSPHRASE` is already filled in. **Without the passphrase
   the backups can't be decrypted**, so keep the Dropbox copy of `prod.env` safe.
4. `deploy/deploy.sh up` (ships the script and the new `prod.env`), then
   `deploy/deploy.sh backup install`, `deploy/deploy.sh backup run` and
   `deploy/deploy.sh backup verify`.

Commands (`deploy/deploy.sh backup …`):

- `run`: take a backup now. The cron job's log is `/var/log/invokedb-backup.log`.
- `list`: the complete backups in the bucket.
- `verify [stamp]`: download a backup (the latest by default), check its checksums, restore
  it into throwaway Postgres and Mongo containers, and print its row and document counts
  beside the live ones. Live data isn't touched. Run it now and then (monthly) to prove
  restores still work.
- `restore <stamp>`: put a backup back into the **live** databases. It asks you to type the
  stamp, stops `api` and `prc`, replaces the Postgres database (`pg_restore --clean`) and
  every Mongo collection in the backup (`mongorestore --drop`), then restarts them. Mongo users
  aren't restored: `mongo-init.js` creates the app user when a volume is new.

On a new server: `bootstrap`, `up`, then `backup restore <stamp>` (skip `init-db`, since the
backup already has the real accounts) and `backup install`.
