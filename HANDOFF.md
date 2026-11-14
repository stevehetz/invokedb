# InvokeDB revamp: handoff

_Last updated 2026-11-14_

InvokeDB ("horizon") is a web app for building data tables you can query through an API. The
revamp makes it run on a modern Mac with no Kubernetes. `README.md` has the commands, and
`AGENTS.md` has the rules, conventions and gotchas. This file covers only where things stand and
what to do next. Git history has the details of past work.

## Start here

1. Read `AGENTS.md` and the matching playbook in `.agents/skills/`.
2. The next job is **step 2.3** below. Check each change with the frontend build and lint.
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

Numbering follows the original plan. Steps 1 (UI smoke baseline), 2.1 (merge the auth
frontend) and 2.2 (Vite) are done. Steps 2.x go on their own branches.

- **2.3 (next):** while still on Vue 2.7, Element UI → Element Plus, `ag-grid-vue` →
  `ag-grid-vue3`, and remove jQuery / jqtree from `h-tree` (then drop `src/core/jquery-global.js`).
- **2.4:** switch to Vue 3 (compat build first). Vuex → Pinia now or later.
- **2.5:** replace the frontend ESLint config (`babel-eslint` / `@vue/prettier`) with a current
  flat config, and drop the leftover prettier 1.19.
- **3 (small, any time):** move `FS_TOKEN` / `WS_SERVER_TOKEN` to env vars.
- **4 (optional):** a `docker-compose.yml` for Postgres and Mongo.
- **5 (before redeploying anywhere):** update the Dockerfiles (`node:10`, `npm run build`) and
  decide between AKS/Helm and something simpler. `ops/` still builds and serves a separate
  `horizon-auth-fe`; the merged app needs one static host with an SPA fallback for `/app/*` and
  the site paths, and `HORIZON_FE_PUB_HTTP_URL` set to it.
- **6 (backend, optional):** Nest 12 / TypeORM 1.x, `stripe` 8 → current (only if Stripe comes
  back), `tslint` → ESLint, and `npm audit` (15 issues, mostly dev tooling).
