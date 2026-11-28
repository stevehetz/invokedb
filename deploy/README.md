# Production deploy (one server)

Everything runs on one DigitalOcean droplet with `docker compose`: Caddy (TLS + the built
frontend), the API (HTTP, websocket broker, uploads), the CSV processor in its own container,
Postgres and Mongo. Only Caddy publishes ports. The images are built on the server from the
committed `HEAD`, so the Mac needs no Docker. `deploy.sh` drives it all over SSH.

| Host                    | Serves                                                |
| ----------------------- | ----------------------------------------------------- |
| `invokedb.com`          | Public site at `/`, app at `/app`                     |
| `api.invokedb.com`      | Backend routes and `/api/v1`                          |
| `ws.invokedb.com`       | Websocket broker (browser connections)                |
| `examples.invokedb.com` | Example apps: the React support desk at `/react-demo` |

The backend gets its own hosts because its routes sit at the root, where they'd clash with the
site's paths.

## First deployment

1. **Droplet:** Ubuntu 24.04, NYC, Basic 2 vCPU / 4 GB (resize to 8 GB if it struggles, and
   raise `MONGO_CACHE_GB` and `PRC_CPUS`), your SSH key, backups on.
2. **Cloud Firewall** on the droplet: inbound TCP 80 and 443 (and UDP 443 for HTTP/3) from
   anywhere, TCP 22 from your IP only.
3. **Cloudflare DNS**, DNS-only (grey cloud): A records `@`, `www`, `api`, `ws` and
   `examples` to the droplet's IPv4. Caddy can't get certificates until these resolve.
4. `deploy/deploy.sh init-env`, then set `DEPLOY_HOST`, `DEPLOY_SSH_KEY` and `ACME_EMAIL` in
   `deploy/prod.env`, and `npm run secrets:push` so it's backed up with the other secrets.
5. `deploy/deploy.sh bootstrap`: installs Docker, adds swap, turns off SSH passwords.
6. Commit, then `deploy/deploy.sh up`: ships `HEAD`, builds both images, runs the migrations
   and starts everything.
7. `deploy/deploy.sh init-db`, **once**: the migrations seed demo accounts whose password and
   API keys are in this public repo, and this gives them random ones.
8. Check `https://invokedb.com`, sign up, upload a CSV.

## Automatic deploys

Every push to `main` deploys itself once CI passes on it (`.github/workflows/cd.yml`),
including merges made by `automerge.yml`. A merge with the workflow token starts no
workflows, so `automerge.yml` starts CI on `main` itself, and when that run passes its `deploy`
job starts `cd.yml` with the commit it checked. The
workflow opens SSH on the Cloud Firewall to the runner's IP, sends `deploy <sha>` over SSH,
then removes the rule again (even if the deploy failed). Its SSH key is locked by
`authorized_keys` to `ci-deploy.sh`, which deploys the commit only if it's still the tip of
`main`, downloading it from the public repo, then runs `release.sh` (build, migrate, restart),
the same as `up`. It ships **code only**: the server's settings live in
`/opt/invokedb/prod.env` (root-only, outside the app folder, so deploys never touch it), and
only `deploy.sh env` or `up` from the Mac write them. If two pushes land close together,
the older one is skipped and the newer one deploys. A push that only changes Markdown starts no
CI, so when everything after the checked commit is Markdown, `ci-deploy.sh` deploys the tip
instead (same code; #53). `/opt/invokedb/app/REVISION` on the server
holds the deployed commit.

Set up once (GitHub: repo Settings → Environments → `production`, deployment branches limited
to `main`):

1. A key just for this: `ssh-keygen -t ed25519 -N '' -C invokedb-ci -f ~/.ssh/invokedb-ci`,
   then `deploy/deploy.sh install-ci ~/.ssh/invokedb-ci.pub`. Rerun `install-ci` after changing
   `ci-deploy.sh`.
2. A DigitalOcean API token with custom scopes `firewall:read` and `firewall:update` only.
3. In the `production` environment: secrets `DEPLOY_SSH_KEY` (the private key file) and
   `DO_FIREWALL_TOKEN`; variables `DEPLOY_HOST` (the droplet IP), `DO_FIREWALL_ID` (the
   `invokedb-prod` firewall's ID, from its page URL) and `DEPLOY_KNOWN_HOSTS` (the droplet's
   line(s) from `ssh-keyscan -t ed25519 <ip>`, run from home).

If the close step ever fails, delete the leftover `/32` SSH rule on the firewall by hand.

## Day to day

- Merging to `main` and pushing deploys it (see above). `deploy/deploy.sh up` still deploys
  the committed `HEAD` of any branch by hand, and also ships `prod.env`; `deploy.sh env` ships
  only `prod.env`. Migrations run before the containers restart.
- `deploy/deploy.sh logs [api|prc|web|postgres|mongo]`, `ps`, `ssh`, or
  `compose <any docker compose args>`.
- Email goes out through Mailgun (`MAILGUN_API_KEY`, `MAILGUN_DN=mail.invokedb.com`, US region,
  free plan). The sending domain's SPF and DKIM records are in Cloudflare, plus a
  `_dmarc.invokedb.com` record (`p=none`). Without a key, emails are printed in `logs api`.
- Contact-form requests are emailed through Mailgun to `SUPPORT_EMAIL` (`support@invokedb.com`,
  which Email Routing forwards to the support Gmail), with `Reply-To` set to the sender, so
  replying in Gmail answers them. If Mailgun refuses the call (down, bad key, quota used up),
  the request goes to Telegram instead (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`); if both
  fail, the form says it could not be sent. Failures after Mailgun accepts the email (routing,
  the Worker, spam filtering) aren't visible to the backend. To set up the bot: message
  `@BotFather`, send `/newbot` and copy the token; send your new bot any message, then open
  `https://api.telegram.org/bot<token>/getUpdates` and copy `message.chat.id`. With neither
  configured, requests are only written to `logs api`.
- Inbound mail to `@invokedb.com` goes through Cloudflare Email Routing to an Email Worker
  (see `email-worker/README.md`): everything is forwarded to the support Gmail. Resets for the
  seeded `demo*@invokedb.com` accounts land there too. UptimeRobot doesn't go through it: its
  alerts go straight to the support Gmail (the account's login email).
- To get into a seeded account after `init-db`, request a password reset.
- The SSH key (`~/.ssh/invokedb`) is synced to Dropbox by `npm run secrets:push`/`pull`, so any
  Mac with the secrets can deploy.

## Example apps

`examples.invokedb.com/react-demo` is the React support desk (`examples/react-demo`, #340): the
`react-demo` service (`react-demo.Dockerfile`, built from `examples/`), a small Node server that
serves the app's build, holds the demo account's API key (`REACT_DEMO_API_KEY`) and passes on
only the calls the app makes, receives the account's webhooks at `/react-demo/webhook`
(signature checked with `REACT_DEMO_WEBHOOK_SECRET`) and streams them to browsers. Caddy's
`examples.{$SITE_DOMAIN}` site proxies `/react-demo*` to it. The demo's data lives in a
dedicated InvokeDB account (internal, so it isn't capped) and is reset to the seed set every day
at 04:00 UTC.

Set up, once:

1. Cloudflare: an `examples` A record (DNS-only) to the droplet.
2. `deploy/deploy.sh install-ci ~/.ssh/invokedb-ci.pub`, so automatic deploys ship `examples/`
   (the image is built from it; the old `ci-deploy.sh` doesn't ship it and the build fails).
3. Sign up the demo account on invokedb.com (e.g. `support-demo@invokedb.com`), verify its email,
   and make it internal in the admin area.
4. `INVOKEDB_PASSWORD=... node examples/react-demo/setup.mjs --base https://api.invokedb.com
--email <account>`: makes the tables, the key, the seed rows and the webhook, and prints
   `REACT_DEMO_API_KEY` and `REACT_DEMO_WEBHOOK_SECRET`.
5. `npm run secrets:pull`, add the two lines to `deploy/prod.env`, `npm run secrets:push`, then
   `deploy/deploy.sh env` (or the next `up`) and restart the service:
   `deploy/deploy.sh compose up -d react-demo`.

Day to day: `deploy/deploy.sh logs react-demo`;
`deploy/deploy.sh compose kill -s SIGUSR2 react-demo` resets the data now. Its `/react-demo/health`
answers `{ ok, configured }`. Re-running `setup.mjs --replace` makes everything again with a new
key and secret.

## Notes

- Data lives in named Docker volumes (`pg_data`, `mongo_data`, `files`, `caddy_data`). Removing
  them (`docker compose down -v`) deletes the database.
- Mongo runs standalone with auth. The app user (`horizon`) is created by `mongo-init.js` the
  first time the volume is initialised, so changing `MONGO_APP_PASSWORD` later needs the
  change made in Mongo too. Same for `POSTGRES_PASSWORD`.
- Changing the domains needs only `prod.env` and an `up`: the browser's runtime env
  (`/env.txt`) is written from them when the web container starts.

## Backups

`deploy/backup.sh` runs on the server. Every night at 07:15 UTC, cron dumps Postgres
(`pg_dump -Fc`) and Mongo (`mongodump --archive --gzip`), encrypts both with
`BACKUP_PASSPHRASE`, and uploads them to a DigitalOcean Spaces bucket as `<stamp>/` with a
`manifest.txt` of checksums. Each run pings Healthchecks.io, which alerts you if a night is
missed or fails, by a webhook integration that posts to the contact-form
Telegram bot (`https://api.telegram.org/bot<token>/sendMessage`, JSON body with `chat_id`
and `text`). Replacing the bot token means updating that webhook too. Backups older than `BACKUP_KEEP_DAYS` (30) are deleted after each
successful run. The uploaded files in the `files` volume aren't backed up: they're temporary,
kept only until the CSV processor has loaded them into Mongo. DigitalOcean's weekly droplet
backup is still on as a second copy. Both copies are with DigitalOcean, so losing the account
loses both; a second provider (e.g. Backblaze B2, same script) is a later option.

Setup, once:

1. **DigitalOcean Spaces** (Spaces Object Storage, $5/month): create a bucket in NYC3 (e.g.
   `invokedb-backups`), with file listing restricted and the CDN off. Then under Access Keys
   create a key with **limited access** to that bucket, permission Read/Write/Delete (delete is
   for the 30-day clean-up). The secret is shown once.
2. **Healthchecks.io:** add a check with a 1-day period and a 2-hour grace, and copy its ping
   URL.
3. In `deploy/prod.env` set `BACKUP_S3_ENDPOINT` (the bucket's endpoint, e.g.
   `https://nyc3.digitaloceanspaces.com`), `BACKUP_S3_BUCKET`, `BACKUP_S3_KEY_ID` (the access
   key), `BACKUP_S3_SECRET` (its secret) and `HEALTHCHECK_URL`, then run
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
