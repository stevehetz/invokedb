# InvokeDB revamp: handoff

_Last updated 2026-11-15_

InvokeDB ("horizon") is a web app for building data tables you can query through an API. The
revamp makes it run on a modern Mac with no Kubernetes. `README.md` has the commands, and
`AGENTS.md` has the rules, conventions and gotchas. This file covers only where things stand and
what to do next. Git history has the details of past work.

## Start here

1. Read `AGENTS.md` and the matching playbook in `.agents/skills/`.
2. The next job is **step 0.05** below (fix the table-access security hole), then **0.1**
   (README demo GIF), then **step 2.3**. Check frontend changes with the frontend build and
   lint.
3. **Don't run the smoke tests** (`ui-smoke.mjs`, `api-smoke.mjs`) unless the user asks. They
   add too much overhead for routine checks.
4. Work on a branch. The user merges to `main` and pushes once they approve.

## Current state

- **Runs locally:** `npm run dev` starts the backend (:8001, ws :9000) and the frontend (:8000,
  public site at `/`, app at `/app`). Login, the API and Mongo writes work.
- **Done and on `main`:** local dev revamp, legacy-ops clean-up, secrets sync, demo data,
  backend upgrade (NestJS 11, TypeORM 0.3, mongodb 6), agent tooling + prettier, UI smoke test,
  `horizon-auth-fe` merged into `horizon-fe`, Vue CLI → Vite 6 on Vue 2.7.
- **Production:** none. The Azure infrastructure was torn down; the scripts are kept for a rebuild.
- **Logins:** `shetzel84@gmail.com` and `demo@invokedb.com` … `demo7@invokedb.com`, password
  `password`.

## Things to know

- **The repo is public.** History was scrubbed of secrets with `git filter-repo` on 2026-11-14
  and force-pushed, so any other clone must be re-cloned. The pre-scrub backup
  `~/dev/invokedb-pre-scrub-2026-11-14.bundle` contains secrets: never push it.
- `packages/horizon-be/src/constants.ts` hardcodes `FS_TOKEN` / `WS_SERVER_TOKEN`. Harmless
  with no deployment; move them to env vars before deploying (step 3).
- **Stripe isn't in use**, and the old keys are deliberately not rolled. If it comes back, create
  new keys. `/checkout` throws `Please call Stripe() with your publishable key` without them.
- For step 2.3: `sass` is pinned at 1.32 for Element UI's theme SCSS (Vite uses the legacy Sass
  API). The two areas' global stylesheets still clash; unify them during the Element Plus work,
  then cross-area links can use the router.
- The entry JS is a single 2.3 MB chunk (577 kB gzip). Vite warns; splitting it is optional.
- `/api/v1/get` leaves out empty cells. That looks intended.
- Your `.env` still has two unused `HORIZON_AUTH_FE_*` lines. Delete them whenever (then
  `secrets:push`).
- `docs/ops-standalone.md` is an old to-do list, mostly done or obsolete.
- **MCP servers checked 2026-11-14.** `playwright` drives the real Google Chrome (login as
  `demo@invokedb.com` reaches `/app` with its menu and table tree, websocket connects).
  `mongodb` lists `horizon:acct_2` and `horizon:tracking` through the `preconfigured`
  connection. Playwright writes snapshots and console logs to `.playwright-mcp/` (gitignored).

## Next steps

Numbering follows the original plan (steps 0 and 0.1 were added later and go first). Steps 1 (UI smoke baseline), 2.1 (merge the auth
frontend) and 2.2 (Vite) are done. Steps 2.x go on their own branches.

- **0: done** (2026-11-15). `stevehetz/invokedb-node` and `stevehetz/invokedb-examples-angular`
  were copied in (no history) as `examples/invokedb-node` and `examples/angular`. They had no
  secrets (the Angular app's `invoke-config.json` is gitignored). Left for the user: archive the
  two old GitHub repos with a README pointing here. Follow-up, same day: the client was moved to
  `fetch` (v2.0.0, unpublished; 1.x bundled axios's browser adapter, so it never ran in Node) and
  defaults to the local backend; the Angular app was rewritten on Angular 22 against new made-up
  CSVs in `examples/data` (the old Dropbox CSVs were gone, and the Game of Thrones sigil images
  were dropped); `examples/setup.mjs` loads the tables and writes the app's API key config.
- **0.05 (next): fix cross-account table access (security).** Found 2026-11-15, not fixed.
  `FileDirectoryController` (`src/web/http/file-directory/file-directory.controller.ts`) checks
  that the caller is logged in, but not that the table belongs to them: `GET
/file-directory?account_id=N` lists any account's tables (it trusts the query parameter), and
  `PUT /file-directory/:id` updates any table by id (`FileDirectoryService.update` has no
  ownership check). Fix: take the account from `req.user` (ignore or verify `account_id`), and
  check `account_id` on every route that takes a table id. `web-file.service.ts` already has a
  helper that throws `UnauthorizedException` when `file_directory.account_id` doesn't match;
  reuse that pattern. Also audit `batch_delete`, the `/web-file/*` routes and the other
  controllers for the same mistake. Add calls to `scripts/api-smoke.mjs` that try another
  account's table (as `demo2@invokedb.com`) and expect 401/403, and verify with the
  `verify-backend` skill. The frontend sends `account_id` today, so keep accepting the
  parameter (but ignore it) so nothing breaks.
- **0.1: a demo GIF for `README.md`.** Show the main flow: log in as
  `demo@invokedb.com`, **upload a CSV** as a new table, sort/filter/edit it in the grid, then
  query it through the API (a `curl` or the Node client from step 0). Use a CSV from
  `examples/data` (`wine_reviews.csv` has text and number columns; `contacts.csv` and `todo.csv`
  have dates; there's no boolean column type, `todo.is_complete` is `yes`/`no`). Capture it with a scripted Playwright run (like
  `scripts/ui-smoke.mjs`) using `recordVideo` on the browser context at a fixed viewport, with
  short pauses so it's readable. Then convert the `.webm` to a GIF with `ffmpeg` (palettegen +
  paletteuse) or `gifski`. Neither is installed yet; `brew install ffmpeg` is a prebuilt binary,
  so the no-native-npm-packages rule doesn't apply. Aim for under ~5 MB and about 15–30 s, save it
  as `docs/demo.gif`, and keep the recording script in `scripts/` so the GIF can be re-made
  after the UI changes (2.3/2.4). Record against the throwaway smoke env, not the user's data.
- **2.3:** while still on Vue 2.7, Element UI → Element Plus, `ag-grid-vue` →
  `ag-grid-vue3`, and remove jQuery / jqtree from `h-tree` (then drop `src/core/jquery-global.js`).
- **2.4:** switch to Vue 3 (compat build first). Vuex → Pinia now or later.
- **2.5:** replace the frontend ESLint config (`babel-eslint` / `@vue/prettier`) with a current
  flat config, and drop the leftover prettier 1.19.
- **3 (small, any time):** move `FS_TOKEN` / `WS_SERVER_TOKEN` to env vars.
- **4 (optional):** a `docker-compose.yml` for Postgres and Mongo.
- **5 (test deployment, on `invokedb.com`):** a cheap, simple deploy for testing, not AKS/Helm.
  Plan: one small VM (Hetzner or DigitalOcean, ~$5–10/month) running `docker compose` with the
  backend, Postgres, Mongo and Caddy (automatic TLS). Caddy serves the built frontend with an
  SPA fallback for `/app/*` and the site paths, and proxies `/api` and the websocket (so `:9000`
  needs no public port). DNS on Cloudflare. Needs first: step 3, step 4 (reuse the compose
  file), new Dockerfiles (the current ones use `node:10` and `npm run build`), the backend
  installed with `--omit=optional`, `HORIZON_FE_PUB_HTTP_URL` set to the public URL, prod
  secrets kept out of git (extend `scripts/secrets.sh`), and a Mongo/Postgres backup cron.
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
