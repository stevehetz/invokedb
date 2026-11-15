# InvokeDB revamp: handoff

_Last updated 2026-11-15_

InvokeDB ("horizon") is a web app for building data tables you can query through an API. The
revamp makes it run on a modern Mac with no Kubernetes. `README.md` has the commands, and
`AGENTS.md` has the rules, conventions and gotchas. This file covers only where things stand and
what to do next. Git history has the details of past work. The longer-term plans sit beside it
in `docs/`: `SAAS_PLAN.md` (turning it into a SaaS) and `AI_IDEAS.md` (AI features).

## Start here

1. Read `AGENTS.md` and the matching playbook in `.agents/skills/`.
2. The next job is **step 4** (or 5). Check backend changes with the backend build (see
   `verify-backend`), and frontend changes with the frontend build and lint.
3. **Don't run the smoke tests** (`ui-smoke.mjs`, `api-smoke.mjs`) unless the user asks. They
   add too much overhead for routine checks.
4. Work on a branch. The user merges to `main` and pushes once they approve.

## Current state

- **Runs locally:** `npm run dev` starts the backend (:8001, ws :9000) and the frontend (:8000,
  public site at `/`, app at `/app`). Login, the API and Mongo writes work.
- **Done and on `main`:** local dev revamp, legacy-ops clean-up, secrets sync, demo data,
  backend upgrade (NestJS 11, TypeORM 0.3, mongodb 6), agent tooling + prettier, UI smoke test,
  `horizon-auth-fe` merged into `horizon-fe`, Vue CLI → Vite 6, account scoping fix (0.05),
  frontend on Vue 3 + Element Plus + ag-grid 32 (2.3–2.5).
- **On branch `chore/env-tokens`, waiting for the user to merge:** step 3, and the move of
  `HANDOFF.md`, `AI_IDEAS.md` and `SAAS_PLAN.md` from the repo root into `docs/`.
- **Production:** none. The Azure infrastructure was torn down; the scripts are kept for a rebuild.
- **Logins:** `shetzel84@gmail.com` and `demo@invokedb.com` … `demo7@invokedb.com`, password
  `password`.

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
- `docs/ops-standalone.md` is an old to-do list, mostly done or obsolete.
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
- **2.6 (optional):** ag-grid 32 → current (Theming API, module registration), and move the
  SCSS off the Sass deprecations that `vite.config.js` silences (`@import`, global `lighten()`).
- **3: done** (2026-11-15). `WS_SERVER_TOKEN` moved from `constants.ts` to the
  `HORIZON_WS_SERVER_TOKEN` env var (see Things to know). The old hardcoded value is in the public
  history and no longer works. `FS_TOKEN` was unused and is gone. An empty token never counts as
  the server token. The user's `.env` got the (empty) `HORIZON_WS_SERVER_TOKEN` entry, lost the
  two unused `HORIZON_AUTH_FE_*` lines, and was synced with `secrets:push` the same day.
- **4 (optional):** a `docker-compose.yml` for Postgres and Mongo.
- **5 (test deployment, on `invokedb.com`):** a cheap, simple deploy for testing, not AKS/Helm.
  Plan: one small VM (Hetzner or DigitalOcean, ~$5–10/month) running `docker compose` with the
  backend, Postgres, Mongo and Caddy (automatic TLS). Caddy serves the built frontend with an
  SPA fallback for `/app/*` and the site paths, and proxies `/api` and the websocket (so `:9000`
  needs no public port). DNS on Cloudflare. Needs first: step 4 (reuse the compose file), new
  Dockerfiles (the current ones use `node:10` and `npm run build`), the backend installed with
  `--omit=optional`, `HORIZON_FE_PUB_HTTP_URL` set to the public URL, `HORIZON_WS_SERVER_TOKEN`
  and other prod secrets kept out of git (extend `scripts/secrets.sh`), and a Mongo/Postgres
  backup cron.
  `ops/` still builds a separate `horizon-auth-fe`; leave it for reference or delete it.
- **5a (domain): done.** `invokedb.com` was bought on Cloudflare Registrar on 2026-11-14, so its
  DNS is on Cloudflare. To point it at Azure, use DNS-only (grey cloud) records so Azure's
  managed certificates issue, or proxy it and use a Cloudflare Origin Certificate with SSL set to
  Full (strict). Cloudflare Email Routing can forward `@invokedb.com` mail for free; Mailgun
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
