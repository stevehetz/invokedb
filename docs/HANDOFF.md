# InvokeDB revamp: handoff

_Last updated 2026-11-22_

InvokeDB ("horizon") is a web app for building data tables you can query through an API. The
revamp makes it run on a modern Mac with no Kubernetes. `README.md` has the commands, and
`AGENTS.md` has the rules, conventions and gotchas. This file covers only where things stand and
what to do next. Git history has the details of past work. The longer-term plans sit beside it
in `docs/`: `INFRASTRUCTURE_PLAN.md` (the current direction: a trial-only showcase on one
server, keeping Mongo), `SAAS_PLAN.md` (turning it into a SaaS) and `AI_IDEAS.md` (AI
features).

## Start here

1. Read `AGENTS.md` and the matching playbook in `.agents/skills/`.
2. **Direction** (see `docs/INFRASTRUCTURE_PLAN.md`): learning plus a showcase, a Stripe
   trial instead of a free tier, one always-on server, and keeping Mongo. **Production is live**
   (2026-11-22) at `https://invokedb.com`; `deploy/README.md` explains how it's run. Off-site
   backups and uptime monitoring are live, and the launch to-do list (step 5) is finished. Next:
   a person checks signup, table creation, CSV upload and API calls in production, then 5b
   (Google/GitHub sign-in). Check backend changes with
   the backend build (see `verify-backend`), and frontend changes with the frontend build and
   lint.
3. **Production is real.** Run `deploy/deploy.sh` server commands (`up`, `migrate`, `init-db`,
   `compose`, `bootstrap`) only when the user asks. `up` ships the committed `HEAD` of whatever
   branch is checked out, so deploy from `main`.
4. **Don't run the smoke tests** (`ui-smoke.mjs`, `api-smoke.mjs`) unless the user asks. They
   add too much overhead for routine checks.
5. Work on a branch. The user merges to `main` and pushes once they approve.

## Current state

- **Runs locally:** `npm run dev` starts the backend (:8001, ws :9000) and the frontend (:8000,
  public site at `/`, app at `/app`). Login, the API and Mongo writes work.
- **Done and on `main`:** local dev revamp, legacy-ops clean-up, secrets sync, demo data,
  backend upgrade (NestJS 11, TypeORM 0.3, mongodb 6), agent tooling + prettier, UI smoke test,
  `horizon-auth-fe` merged into `horizon-fe`, Vue CLI → Vite 6, account scoping fix (0.05),
  frontend on Vue 3 + Element Plus + ag-grid 32 (2.3–2.5), the websocket server token in an env
  var (3), `HANDOFF.md`, `AI_IDEAS.md` and `SAAS_PLAN.md` moved from the repo root into
  `docs/`, the `CsvProcessor` concurrency fix, the production deploy (5, `deploy/`), off-site
  backups, Telegram for the contact form, and Slack removed entirely (code, packages, config,
  docs; the Telegram bot is the only support channel).
- **Production:** `https://invokedb.com` on one DigitalOcean droplet (see step 5 and
  `deploy/README.md`). The old Azure infrastructure was torn down.
- **Logins (local only):** `shetzel84@gmail.com` and `demo@invokedb.com` …
  `demo7@invokedb.com`, password `password`. In production these accounts exist but have
  random passwords and API keys (`init-db`); get into one with a password reset. Reset emails
  go out through Mailgun, but `invokedb.com` receives no mail (no MX, by choice), so
  `demo*@invokedb.com` resets bounce.
  `shetzel84@gmail.com` was reset this way and works.

## Things to know

- **The repo is public.** History was scrubbed of secrets with `git filter-repo` on 2026-11-14
  and force-pushed, so any other clone must be re-cloned. The pre-scrub backup
  `~/dev/invokedb-pre-scrub-2026-11-14.bundle` contains secrets: never push it.
- **`HORIZON_WS_SERVER_TOKEN`** is the shared secret that backend processes register with the
  websocket broker. It's optional locally (random per process) and required elsewhere (startup
  fails without it). Every process in a deployment needs the same value.
- **Stripe isn't in use**, and the old keys are deliberately not rolled. If it comes back, create
  new keys. `/checkout` throws `Please call Stripe() with your publishable key` without them.
- The two areas' global stylesheets still clash (see AGENTS.md); unifying them would let
  cross-area links use the router. Optional.
- The entry JS is a single 2.3 MB chunk (577 kB gzip). Vite warns; splitting it is optional.
- `/api/v1/get` leaves out empty cells. That looks intended.
- `docs/ops/` holds the old Azure/AKS ops notes, for reference only.
- **Production secrets** are in `deploy/prod.env` (gitignored; DB passwords, websocket token,
  Mailgun key, droplet IP, SSH key path `~/.ssh/invokedb`). It and the SSH key pair are synced
  to Dropbox with the other secrets by `npm run secrets:push`/`pull` (the key under `home/` in
  the secret folder); check `npm run secrets:status` shows them as `same`. On a new Mac, run
  `secrets:pull` before deploying.
- **SSH to production is allowed only from the user's home IP** (DigitalOcean Cloud Firewall
  `invokedb-prod`). If SSH times out, the home IP probably changed: update the firewall's SSH
  rule, or use the droplet's Web Console.
- **MCP servers checked 2026-11-14.** `playwright` drives the real Google Chrome (login as
  `demo@invokedb.com` reaches `/app` with its menu and table tree, websocket connects).
  `mongodb` lists `horizon:acct_2` and `horizon:tracking` through the `preconfigured`
  connection. Playwright writes snapshots and console logs to `.playwright-mcp/` (gitignored).

## Next steps

Numbering follows the original plan (steps 0 and 0.05 were added later and go first). Steps 1 (UI smoke baseline), 2.1 (merge the auth
frontend) and 2.2 (Vite) are done. Steps 2.x go on their own branches.

- **0: done** (2026-11-15). `stevehetz/invokedb-node` and `stevehetz/invokedb-examples-angular`
  were copied in (no history) as `examples/invokedb-node` and `examples/angular`. They had no
  secrets (the Angular app's `invoke-config.json` is gitignored). Left for the user: archive the
  two old GitHub repos with a README pointing here. Follow-up, same day: the client was moved to
  `fetch` (v2.0.0, unpublished; 1.x bundled axios's browser adapter, so it never ran in Node) and
  defaults to the local backend; the Angular app was rewritten on Angular 22 against new made-up
  CSVs in `examples/data` (the old Dropbox CSVs were gone, and the Game of Thrones sigil images
  were dropped); `examples/setup.mjs` loads the tables and writes the app's API key config.
- **0.05: done** (2026-11-15). Internal routes now take the
  account from the login session (`web/http/_auth/request-account.ts`) and ignore any
  `account_id` the frontend sends. `/file-directory` checks ownership on list, create, validate,
  update and batch delete, and checks that a `parent_id` is one of the caller's own folders (no
  move cycles). `/web-file/*` already checked; the upload now uses the session account.
  `/account/*` had **no auth at all** (anyone could rename, re-password or delete any account,
  and `POST /account` listed every account): the routes are guarded and only act on the caller's
  own account, and the list route is gone. API keys now only work on `/api/v1`, and `/api/v1`
  only takes an API key (a login token used to crash it with a 500). Also: session
  and reset-token expiry are enforced (they never were), sessions are revoked when a password
  reset completes instead of when it's requested, and `batch_delete` now drops the Mongo data of
  every deleted table (it only did the last one). `api-smoke.mjs` has 19 new cross-account
  checks as `demo2@invokedb.com`; the pre-fix code fails all of them. Left alone: the Stripe
  `/webhook/stripe` route doesn't verify signatures (Stripe is off; fix before it comes back).
- **2.3–2.5: done** (2026-11-15). Element Plus and `ag-grid-vue3` need
  Vue 3, so 2.3 couldn't happen on Vue 2.7; all three steps were done together, straight to Vue
  3.5 (no compat build): vue-router 4, Element Plus 2.14 (app theme in `src/element-theme.scss`),
  ag-grid 22 → 32.3 (the last version before v33's theming/modules overhaul; 33+ is a later
  step), jqtree → Element Plus `el-tree`, all jQuery → DOM/`fetch`, `Vue` event bus → a small
  emitter, highlight.js bundled from npm instead of the CDN, current `sass`, ESLint 10 flat
  config. Dropped: `element-ui`, `ag-grid-vue`, `jqtree`, `jquery`, `vue-property-decorator`,
  and the unused `EventEmitter` package (it pulled in gulp/babel 6). 544 → 265 packages.
  Checked with build + lint, screenshots of 15 screens against the Vue 2 build (side by side;
  differences fixed) and a Playwright pass of upload, cell edit, add row, column rename, table
  add/rename/delete, account save and logout. Not run: `ui-smoke.mjs` (its filter selector was
  updated for ag-grid 32). Pinia: not needed, the app has no Vuex (it uses `src/store`, an
  rxjs `BehaviorSubject` map). Known differences: entering Edit Columns now refetches rows
  (ag-grid 32 reacts to filtering being switched off), so the row count resets to the unfiltered
  total.
- **CSV processor concurrency: done** (2026-11-22). One processor could run two job loops at
  once (`wake_file_processor` checked `job_state` before an await, and `file_delete_request`
  skipped the check), and `CsvProcessor` kept job state on the singleton, so they clobbered
  each other. Now `check_for_jobs` claims the loop before its first await and survives a
  throwing job, `CsvProcessor` keeps per-job state (rows, counter, deadline, cancel flag) and
  reads the CSV with backpressure so every batch insert is awaited in order, and timeouts are
  per job (an old job's 30-minute timer could fail a later one). The column type change in
  `WebFileManager` got a per-call deadline too. Checked with the backend build only.
- **2.6 (optional):** ag-grid 32 → current (Theming API, module registration), and move the
  SCSS off the Sass deprecations that `vite.config.js` silences (`@import`, global `lighten()`).
- **3: done** (2026-11-15). `WS_SERVER_TOKEN` moved from `constants.ts` to the
  `HORIZON_WS_SERVER_TOKEN` env var (see Things to know). The old hardcoded value is in the public
  history and no longer works. `FS_TOKEN` was unused and is gone. An empty token never counts as
  the server token. The user's `.env` got the (empty) `HORIZON_WS_SERVER_TOKEN` entry, lost the
  two unused `HORIZON_AUTH_FE_*` lines, and was synced with `secrets:push` the same day.
- **4: dropped** (2026-11-15). A dev compose file for Postgres and Mongo isn't needed: local
  dev uses Postgres.app and brew Mongo, and Docker isn't installed on the Mac. The production
  compose file belongs to step 5.
- **5 (first deployment, on `invokedb.com`): live** (2026-11-22). One DigitalOcean droplet,
  `invokedb-prod` (Basic Regular 2 vCPU / 4 GB / 80 GB, NYC2, `107.170.54.96`, weekly backups,
  ~$29/month), running everything in `docker compose`: Caddy (TLS + the built frontend at
  `invokedb.com`, proxying `api.` and `ws.`), the API, the CSV processor in its own container,
  Postgres 17 and Mongo 8 (standalone, auth on, cache capped). `deploy/README.md` has the
  details; `deploy/deploy.sh` drives it over SSH and builds the images on the server. The
  backend gained `dist/database/migrate.js` for migrations without ts-node. Cloud Firewall: SSH
  from the user's IP only, 80/443 TCP and 443 UDP from anywhere. Cloudflare DNS (DNS-only) has
  `@`, `www`, `api` and `ws` A records to the droplet. Checked on launch: site and `/app` load,
  `www` redirects, certificates issued, the websocket upgrades, seeded logins and API keys are
  rejected. **Email: live** (2026-11-22) through Mailgun on `mail.invokedb.com` (free plan,
  US region; SPF, DKIM and a `p=none` DMARC record in Cloudflare); a password reset reached
  Gmail. The old Mailgun account still holds `mg.invokedb.com` and wouldn't delete it, hence
  `mail.`. **Not yet checked by a person:** signup, table creation, CSV upload and API calls in
  production. Hetzner was dropped because its US prices roughly tripled in June 2026.
  - **Still to do, in order:**
    1. **Account enumeration: done** (2026-11-22, branch `auth-generic-messages`). Login says
       "Invalid email or password" either way and runs a bcrypt compare against a dummy hash
       when there's no account (same timing). Reset always answers `success` (the page says
       "If an account exists…"). Signup still says "An account with that email already
       exists"; closing that needs email verification on signup. Checked with builds only.
    2. **Monitoring: done** (2026-11-22). UptimeRobot (free plan, 5-minute checks, email alerts)
       on `https://invokedb.com` and `https://api.invokedb.com/auth/authorize` (the bare API
       root is a 404, which UptimeRobot counts as down; `authorize` with no token answers 200
       without touching the DBs, so it doesn't catch a DB outage). Sentry: optional, not set up.
       Telegram alerts are a paid UptimeRobot feature, so instead: **inbound email → Telegram**
       (`deploy/email-worker/`, Cloudflare Email Routing + an Email Worker; written and tested
       locally 2026-11-22, **dashboard setup pending**). Once live, point UptimeRobot at
       `alerts@invokedb.com`.
    3. **Mailgun's authorized-recipients limit: not an issue** (checked 2026-11-22). It applies
       only to the sandbox domain (whose list holds just the Mailgun login address).
       `mail.invokedb.com` on the current Free plan (3,000 emails/month, no card) delivered the
       reset to `shetzel84@gmail.com`, which isn't on that list. If the reset form is ever
       abused to burn the quota, rate-limit `/auth/reset-password`.
  - **Off-site backups: live** (2026-11-22). `deploy/backup.sh`, driven by
    `deploy.sh backup run|list|verify|restore|install`, runs nightly from cron at 07:15 UTC on
    the server: an encrypted (`BACKUP_PASSPHRASE`, openssl AES-256) `pg_dump` + `mongodump`
    goes to the DigitalOcean Spaces bucket `invokedb-backups` (NYC3, limited-access key), with
    backups over 30 days deleted after each successful run. It pings Healthchecks.io (check
    "invokedb backups", 1 day + 2 h grace), which alerts on a failed or missed run by Telegram only (email is off) (a Healthchecks webhook to the contact-form bot's `sendMessage`; if the bot
    token is ever revoked, update it there too). The first
    backup and `backup verify` (restore into throwaway containers, counts compared with live)
    passed on launch. The settings are in `prod.env`; `deploy/README.md` "Backups" has the
    details and the new-server restore. The weekly DigitalOcean droplet backup stays on as a
    second copy; both live in the DigitalOcean account, so a second provider (B2, same
    script) is an option later. Logs: `/var/log/invokedb-backup.log` on the server. rclone
    prints a harmless "Config file not found" notice (it's configured by env vars).
  - **Later:** a bigger droplet (a resize keeps the data; raise `MONGO_CACHE_GB` and `PRC_CPUS`),
    managed DBs, or more servers, if it ever needs them. It's all standard Docker, Postgres and
    Mongo, so moving is a migration, not a rewrite.
  - `ops/` (the old AKS/Helm setup) still builds a separate `horizon-auth-fe`; leave it for
    reference or delete it.
- **5a (domain): done.** `invokedb.com` was bought on Cloudflare Registrar on 2026-11-14, so its
  DNS is on Cloudflare. The A records (`@`, `www`, `api`, `ws`) are DNS-only (grey cloud),
  so Caddy's Let's Encrypt certificates issue simply; turning on the proxy later needs SSL set
  to Full (strict). Cloudflare Email Routing can forward `@invokedb.com` mail for free; Mailgun
  needs its DNS records added there if outbound email comes back.
- **5b (single sign-on: Google and GitHub):** after 5 and 5a, since the OAuth apps need real
  callback URLs (also register `http://127.0.0.1:8001` callbacks for local dev). Today login is
  email + bcrypt password, which creates an `internal_…` `Session` token that
  `application/auth/http.strategy.ts` validates as a bearer token. Plan: add
  `passport-google-oauth20` and `passport-github2` (pure JS) with `/auth/google` and
  `/auth/github` routes. The callback finds or creates the account, creates a `Session` as the
  password login does, and redirects to the frontend with the token. A migration adds an
  `account_identity` table (`provider`, `provider_user_id`, `account_id`) and makes
  `password_hash` nullable. Link an SSO login to an existing account only by a **verified**
  email (for GitHub, fetch `/user/emails` and take the primary verified one). Add the buttons to
  the login and signup pages, and the client IDs/secrets to `src/env.ts` and `.env`.
- **6 (backend, optional):** Nest 12 / TypeORM 1.x, `stripe` 8 → current (only if Stripe comes
  back), `tslint` → ESLint, and `npm audit` (15 issues, mostly dev tooling).
