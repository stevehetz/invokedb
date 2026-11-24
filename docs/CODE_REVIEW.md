# Code review: findings

_2026-11-24. HANDOFF, Next steps, item 7._

A review of `packages/horizon-be`, `packages/horizon-fe`, `deploy/`, `scripts/`, `examples/`
and `.github/`, aimed at clean-up and the developer workflow. It is ranked by value for effort:
**A** = do soon (risk or real friction), **B** = worthwhile clean-up, **C** = nice to have.
Each finding has an ID so you can pick by ID.

**Status:** every finding is a GitHub issue (board: https://github.com/users/stevehetz/projects/1):
A1–A3 #6; A4, B3, B4, B7 #7 (**done**, 2026-11-24); A5 #8 (**done**, 2026-11-24); B1 #9; B8, C1, C3 #10; B2, B6, C5
#11; B5 #12; C4 #13; C2, C6 #14.

What's already in good shape: `deploy/` (small, commented scripts and a locked-down CI deploy
key), the CI/CD/review workflows, the root prettier setup with its pre-commit hook,
`.editorconfig`, `.nvmrc`, and account scoping in the controllers that 0.05 touched. Backend
`tslint` currently passes with no errors.

## A: do soon

**A1. Stripe code is live in production with no Stripe behind it.**
`POST /webhook/stripe` is unauthenticated and doesn't verify the Stripe signature, so anyone
who knows (or guesses) a `stripe_customer_id` can change that account's subscription.
`/subscription/*` and `/stripe/pk` are still mounted, `index.html` loads `js.stripe.com/v3` on
every page (a third-party script inside `/app` too), and `/checkout` and `/pricing` are
routed. The SDK is `stripe` 8 (2020).
_Fix:_ remove it end to end now: `WebhookController`, `StripeController`,
`SubscriptionController`'s Stripe routes, `StripeEnvService`, the `stripe` package, the
checkout page and the Stripe `<script>`. Keep the `subscription` / `stripe_env` tables (a
migration can drop them later). When the Stripe trial is built (INFRASTRUCTURE_PLAN), write it
fresh on the current SDK with signature checks. If you'd rather keep the pages, at least
delete the webhook route.

**A2. The old Azure setup is still wired in.**
`ops/` is ~100 files and **68 MB in git** (`ops/shared/dumps/demo` holds BSON and a Postgres
`.bak`). `package.json` has 33 `prod:*` scripts plus `base:construct` that target torn-down
Azure resources (AGENTS.md has to warn agents off them). `scripts/secrets.sh` and
`.gitignore` still list the Azure `*.values.sh` files and the old SSH keys; `docs/ops/` is
the matching notes.
_Fix:_ delete `ops/`, `docs/ops/`, the `prod:*`/`base:construct` scripts and the Azure
entries in `secrets.sh` and `.gitignore` (history keeps them). Two things depend on `ops/`
first, see A3.

**A3. The demo data and the logs DB depend on `ops/`.**
`npm run db:demo` restores `ops/shared/dumps/demo`, and `db-setup.sh` / `db-demo.sh` create a
`horizon_logs` database from `ops/shared/log-table.sql`. That DB only exists for the optional
native `@pauleliet/winston-pg-native` log transport, which is never installed (`--omit=optional`
everywhere), so nothing writes to it.
_Fix:_ drop the Postgres log transport, `POSTGRES_LOG_LEVEL` and `horizon_logs`. Replace the
binary dump with `examples/setup.mjs` (it already loads tables through the API from readable
CSVs), or move a smaller dump to `scripts/demo/` if a direct restore is still wanted.

**A4. `npm run push` no longer fits the workflow.**
`push.sh` does `git add -A`, commits, bumps every `version` (2.0.371), tags and pushes `HEAD`.
With PR-only `main` that push is rejected on `main`, and on a branch it tags unreviewed code.
`packages/horizon-fe/internals/bp.sh` still pushes to `master`.
_Fix:_ delete `push.sh`, the `push` script and `internals/bp.sh` (and `internals/template`,
a component scaffold, unless you use it). If you want versions, let `cd.yml` tag what it
deploys (e.g. `deploy-YYYYMMDD-<sha>`).

**A5. No automated tests, and the API smoke test isn't in CI.**
Jest is configured but there are no specs; `test:e2e` points at a missing `./test`.
`scripts/api-smoke.mjs` (incl. 19 cross-account checks) is the real safety net but only runs
by hand.
_Fix:_ (1) run `api-smoke.mjs` in CI on every push (an estimated 2–3 minute job running alongside the others; nightly would only catch a break after it has deployed) against Postgres and Mongo service containers (it already
takes a base URL and `smoke-env.sh` builds the env); this is the largest single gain. (2) Add a
few Jest unit tests where logic is pure: `request-account.ts`, `core/helpers/validators.ts`,
`WebFileManager.validate_column_header`, the file-directory name validator. Remove `test:e2e`
until there is one.

## B: worthwhile clean-up

**B1. Backend lint is `tslint` (deprecated 2019) and types are loose.** `noImplicitAny: false`,
no `strict`. _Fix:_ ESLint 10 + `typescript-eslint` flat config like the frontend's, then turn
on `strict` in steps (`strictNullChecks` last). Already listed under step 6; worth doing
before new backend work (5b).

**B2. The frontend has two HTTP layers** from the two-app merge: `src/core/http` +
`src/core/context/*` (app) and `src/network/http/*` with `HttpBase` (site). There are two
`subscription-http.js` files. _Fix:_ one client in `src/core/http`; the site's account,
support and subscription calls move onto it.

**B3. Unused packages.**
Frontend: `@fortawesome/fontawesome-free` (Font Awesome is loaded from a CDN instead),
`express`, `moment-timezone`, `postcss-nested` (also the source of the high `postcss` audit
finding), `rxjs-compat`; `jsonfile` is only used by `env.js` (plain `fs` will do).
Backend: `supertest` and `@nestjs/testing` until A5 adds tests; `module-alias` could go with a
`tsc-alias` build step (optional). `nest-cli.json` is there without `@nestjs/cli`.
_Fix:_ uninstall them; build + lint to confirm.

**B4. Dead config and files.**

- `env.ts` reads 9 vars nothing uses: `ENV`, `HORIZON_FS_PRIV_HTTP_PORT`,
  `HORIZON_FS_PRIV_HTTP_URL`, `HORIZON_PRC_PRIV_HTTP_PORT`, `MAILGUN_IP_ADDRESS`,
  `MAILGUN_SMTP_HOSTNAME`, `MAILGUN_SMTP_LOGIN`, `MAILGUN_PW`, `MAILGUN_API_URL`. Remove them
  from `env.ts`, `.env.example` and `deploy/prod.env.example` (`MAILGUN_API_URL`).
- `constants.ts`: `PostgresDbConnectionToken`, `MongoDbConnectionToken` unused.
- `packages/*/Dockerfile` and their `.dockerignore`: `node:10`, unused since `deploy/*.Dockerfile`.
- `packages/horizon-be/readme.md`: the stock Nest starter README. Replace with three lines
  pointing at the root README, or delete.
- `src/email/test.template.html`; frontend assets `guide-1.png`, `logo.png`, `table-grid.svg`.
- `nodemon-debug.json` / `start:debug` and `prestart:prod` / `start:prod` (production runs
  `node dist/main.js` from the Dockerfile); keep only what `scripts/` uses.
- `workspaces/horizon-sh.code-workspace` repeats `.vscode/` settings; keep one.

**B5. Backend structure and naming.**

- `src/websocket/*.manager.ts` are ES5 prototype objects (`util.inherits`, `require`,
  `module.exports`) in `.ts` files, so they're untyped. Rewrite as classes extending
  `EventEmitter` with typed messages.
- `WebsocketClientStore` is a provider in three modules (Core, Application, Web); it only works
  because its state is module-level globals. Provide it once (Core) and export it.
- Folder `application/stripe.service/` (goes with A1), file `file-directory-name-validatior.ts`
  (typo), `database/_ormconfig.ts` (underscore prefix is unique in the repo).
- `SubscriptionController` / `StripeController` use `req.user.account_id` directly instead of
  `session_account_id(req.user)` (AGENTS.md convention); moot if A1 removes them.

**B6. CDN assets in `index.html` that should be bundled.** Font Awesome 5.13.1 from cdnjs
and highlight.js **9.12** CSS from jsDelivr, while the JS is highlight.js **10** from npm.
_Fix:_ import both from npm in the shells that use them (with B3, Font Awesome is already in
`package.json`). Fewer third-party requests, versions match, works offline in dev.

**B7. Dependency audit.** Frontend: `js-cookie` 2 (high; upgrade to 3, small API change) and
`postcss` via `postcss-nested` 4 (B3). Backend: 5 moderate (`csv-parse` < 7, not reachable
here since the processor doesn't use the `columns` option; `glob`/`minimatch` under TypeORM).
_Fix:_ handle with B3, bump `csv-parse` to 7 when convenient. Add Dependabot (B8) so this
doesn't drift.

**B8. CI gaps.**

- No Dependabot/Renovate: add `.github/dependabot.yml` for npm (4 lockfiles) and
  `github-actions`, weekly, grouped minor/patch.
- `examples/` isn't built in CI: add a job running `tsc` for `invokedb-node` and `ng build`
  for the Angular app (both have lockfiles), so the client stays in step with the API.
- No `shellcheck` on `deploy/*.sh` and `scripts/*.sh`, which run on the production server.

## C: nice to have

**C1. A root `npm run check`** that runs what CI runs (backend build + lint, frontend build +
lint, `format:check`), so "green locally" means "green in CI". Agents and the
`verify-backend` playbook can then call one command.

**C2. Frontend type checking.** It's plain JS with Options API. Cheapest step: `checkJs` in
`jsconfig.json` plus a `tsc --noEmit -p jsconfig.json` script, fixing or `// @ts-nocheck`-ing
files as you go. A full move to TypeScript/`vue-tsc` isn't worth it now.

**C3. A PR template** (`.github/pull_request_template.md`): what changed, how it was checked
(build / lint / smoke), whether it needs a migration or a `prod.env` change. The last two are
the things that bite on deploy.

**C4. Repo metadata.** Root `package.json` still says `"description": "Web documents"` and
points at a Bitbucket repo; licences disagree (root ISC, backend MIT, client ISC) and there is
no `LICENSE` file in a public repo. Decide on one and add the file.

**C5. Frontend bundle** is one 2.3 MB chunk (known). Lazy-load ag-grid and highlight.js with
the `/app` shell, or set `manualChunks`. Pairs with 2.6 (ag-grid 33+).

**C6. `moment`** in both packages (logger, grid filters, subscription form). Replace with
`Intl.DateTimeFormat` / small helpers when those files are touched; not worth a pass alone.

## Suggested order

A1, A2 + A3 together (one PR: remove Stripe and Azure leftovers), A4 and B4 (one small
"dead files" PR), then A5 (smoke test in CI), B1, B8. Everything else when nearby code is
touched.
