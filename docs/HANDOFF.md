# InvokeDB: handoff

_Last updated 2026-11-26 (afternoon)_

InvokeDB ("horizon") is a web app for building data tables you can query through an API, live at
`https://invokedb.com`. This file says where things stand and what a new session must know.
Elsewhere:

- `AGENTS.md`: rules, conventions, gotchas (read first). `README.md`: commands.
- **The Project board "InvokeDB"** (https://github.com/users/stevehetz/projects/1): all work,
  in priority order. "What's next" is the top `Todo` item (AGENTS.md, "How work is tracked").
- `docs/OPERATIONS.md`: every outside service and GitHub workflow, its secrets by name, who it
  alerts, how to check it. `deploy/README.md`: the server and deploys.
- `docs/INFRASTRUCTURE_PLAN.md`: the hosting direction (one server, keeping Mongo, a free tier
  then paid plans). `docs/PRICING.md`: tiers, limits, costs and their test plan (#137).
  `docs/DEPENDENCY_PINS.md`: packages that only move by a rule. Feature ideas are issues on the
  board, not docs (`SAAS_PLAN.md`, `AI_IDEAS.md` and `CODE_REVIEW.md` were retired 2026-11-25).
- The GitHub wiki has an Infrastructure page with the diagrams from `docs/images/`; the docs in
  the repo stay the source of truth (agents and workflows read them).
- Git history and closed issues/PRs: everything done so far.

## Where things stand (2026-11-26, afternoon)

Production is green (E2E passed 13:25 UTC on 2026-11-26). Everything below is merged and
deployed unless it says otherwise. Details: `gh pr list --state merged`.

- **Shipped 2026-11-25/26** (agent + owner sessions): scoped API keys (#179); **AI** (Haiku 5.5,
  capped per `docs/PRICING.md` 3.5): one **Ask AI** button on the grid that answers questions
  (read-only queries), proposes rows (#235), edits rows with a preview and undo (#243), cleans
  up data (#278), turns pasted text into rows (#284), plus AI columns (#292) and Table from a
  Description; **per-plan limits and a usage display** (#276, the tiers of `PRICING.md` 3.2);
  two-factor sign-in (#247), data export (#254), per-key rate limits and request logs (#255),
  audit log (#256), API quota emails at 80/100% (#291); schema diagram, calendar and map views,
  help pages and a live changelog (#260, #267), the Python client (#258), the **admin area**
  (#283, #289), self-hosted **error tracking and `/status`** (#293); Stripe-era leftovers
  removed (#294); an account menu at the top right (#271, #273).
- **Removed:** dashboards (#209 → removed in #265; data dropped in production).
- **Open PRs:**
  - **#280** (#184, read-only over-cap accounts + deleting idle free accounts): CI green,
    `review-ok`, **held for the owner** (it deletes accounts). Merging it unblocks **#279**
    (delete an account's data on account deletion), which is `agent-stuck` only because it
    builds on #280's `AccountDeletionService`: after #280 merges, remove `agent-stuck` from
    #279 (its PR must open with `hold` too).
  - **#153** Stripe: parked. Pricing is now decided (`PRICING.md` 3.2), and #294 dropped the old
    `subscription`/`stripe_env` tables it planned to reuse, so it needs a fresh start: close it
    and let the agent redo #129 from the decided pricing when the owner wants billing.
- **Queue (`agent`):** #268 (E2E transient 502), #184 (has PR #280), #279 (blocked on #280).
- **Next for a local session: #290, light and dark theme** for the whole app (the owner liked
  the admin area's dark look). Not started. Notes for whoever picks it up:
  - The app's theme today is `<body class="default">` (`index.html`) plus 37 `body.default`
    rules at the end of `stylesheet.scss` (they make the tree and menus dark). Most of the app
    chrome is dark (header, tree, grid top bar, kanban: `$gray400`–`$gray600`, `#232323`,
    `#494652`, accent `#696fe4`); Account settings, many dialogs and Element Plus's components
    are light. `stylesheet.scss` is ~4,900 lines with ~600 literal colours.
  - Plan agreed in the issue: colour tokens (CSS variables) on `<html>` with
    `data-theme="light|dark"`, Element Plus's dark mode (`dark` class + its CSS variables) on
    the same switch, the grid's theme (`h-data-grid/grid-theme.js`), then the surfaces page by
    page. System/Light/Dark in the account menu, saved on the account and in `localStorage`,
    applied before first paint. The public site follows the system setting.
  - The owner allowed Playwright screenshots of the **local** app (demo account) to check both
    themes while building; hand the running app (`npm run dev`, :8000) to the owner to review.
- **Incident (2026-11-25), fixed:** a stale local `prod.env` was pushed to Dropbox and the
  server, which turned off Google/GitHub sign-in for a few minutes. Always `npm run
secrets:pull` (and check `secrets:status`) before editing or deploying `prod.env`.
- **Production secrets now set** (`prod.env`): `ANTHROPIC_API_KEY`,
  `HORIZON_AI_MONTHLY_BUDGET_USD=20`, `HORIZON_AI_MODEL=claude-haiku-5-5`, `HORIZON_TOTP_KEY`
  (never change it: 2FA users would be locked out), `HORIZON_ADMIN_EMAILS` (the owner).
- **Production:** one DigitalOcean droplet running `docker compose` (Caddy, API, CSV processor,
  Postgres 17, Mongo 8). Nightly encrypted off-site backups, UptimeRobot, Healthchecks, Mailgun
  email, Cloudflare DNS and Email Routing, Google and GitHub sign-in (checked by hand).
- **Delivery:** every change goes through a PR: CI, a Claude review, auto-merge for safe PRs,
  deploy on merge, then E2E. Claude workflows also repair failed CI/CD/E2E, revise after review,
  resolve conflicts, work `agent`-labelled issues in board order, fix or dismiss CodeQL alerts
  every 3 hours and update npm packages monthly. Merged branches are deleted automatically.
- **Tests:** backend unit tests (Jest, ~870), the API smoke test and the Python client's tests
  on every PR; the UI test
  (`scripts/ui-smoke.mjs`) runs **against production** only (`e2e.yml`: nightly 06:00 UTC and
  after each deploy, as `e2e@invokedb.com`; a failure sends Telegram, keeps a masked screenshot
  and starts repair). The frontend has no tests of its own.

## The cloud agent's queue (fixed 2026-11-25)

- It reads the **board order** with a direct GraphQL query (#155); `gh project ... --owner`
  fails with "unknown owner type" for this user project, so never use it in workflows (#154,
  #193). `PROJECTS_TOKEN` is a **classic** token with the `project` scope (read the order, add
  issues to the board).
- A stuck agent PR (failed CI, idle, out of review rounds) gets `agent-stuck` and the queue
  **moves on** (#157), but it **holds once two agent PRs are stuck** (#159). To unblock: park
  them with `hold` (and remove `agent-stuck`), merge, or close.
- Agent-found **bugs** (not `security`) get `agent` from the workflow and are queued by
  themselves (#197); other agent-found issues wait for the owner's `agent` label.
- One issue at a time, ~10 minutes for an easy one. It can't edit `.github/workflows/` and can't
  ask questions: put decisions in the issue body before labelling.
- Watch it: `gh run list -w agent-queue.yml` (log line "Board order: …" then "Started
  implement.yml on #N"), `gh pr list --label agent-pr`.
- **The queue's 30-minute schedule is unreliable** (GitHub ran it twice in a day): the queue
  really moves on events (a PR merged, closed or labelled, an issue labelled). If a run sees an
  agent PR a moment before it's parked, it waits and nothing else wakes it; it once sat idle for
  six hours. If nothing has started for a while, `gh workflow run agent-queue.yml`.
- **An issue that isn't on the board is never picked up** (#277 was missed by the board's
  auto-add). Check with the GraphQL items query, and add it with `addProjectV2ItemById` and
  `updateProjectV2ItemPosition` (top) and set Status to Todo.
- **To hold an agent PR for the owner**, say so in the issue ("open the PR with the `hold`
  label"); the agent usually does, but check, and add `hold` if it didn't before CI and the
  review finish (auto-merge acts then). Closing an agent PR marks its issue `agent-stuck`, and a
  second queue run can re-add the label after you remove it: check again a minute later.
- A run that ends "failed" after Claude finished (e.g. "exceeding the configured maximum of 200
  turns") may still have opened its PR; look before retrying.
- **repair.yml on agent PRs** (#267, #287): it pushes the fix straight onto the agent PR's
  branch (at most 2 pushes per PR, none once `agent-stuck`), which starts CI and the review;
  elsewhere it opens a `claude/fix-*` PR. It only works on agent PRs since `allowed_bots`
  includes `claude` (#287).

## Decisions to respect

- **Pricing direction** (2026-11-24): a **very limited free tier** so people can try it out,
  then paid tiers through **Stripe, which comes back** (#129). Caps and prices come from the
  pricing review (#137). This replaced "a trial instead of a free tier".

- **Pricing decided** (2026-11-25, `docs/PRICING.md`): Free / Starter $9 / Pro $29 with the
  caps of 3.2 (incl. audit log 7/30/90 days, per-key limits on paid tiers only), no trial,
  the behaviour of 3.4 (read-only over the caps after a downgrade, idle free accounts deleted
  after 6 months with warnings). Enforced by #276 (and #184 when it merges).
- **AI costs are capped in the pricing** (2026-11-25, `docs/PRICING.md` 3.5): Haiku 5.5 for
  every tier, monthly allowances (Free: 10 questions, 50 generated rows; every AI-column cell
  counts as a row), a dollar budget per account and server-wide, and Sonnet 5.5 only as a
  separate paid add-on (#224, after Stripe). AI features go through `AiSpend` and `AiClient`.
- **One AI button** (2026-11-25): everything AI on a table lives in **Ask AI**; the AI never
  saves by itself (proposed rows and edits are reviewed, then saved by the user).
- **Dashboards removed** (2026-11-26): the owner didn't want them (#264).
- **No map work** (2026-11-26): the basic map view (#211) stays; no base map or geocoding (#245
  closed).
- **Admins** (2026-11-26): `HORIZON_ADMIN_EMAILS` + a verified email + a second factor: our
  two-factor sign-in for a password account; a Google/GitHub-only account (no password) passes,
  trusting the provider (#288).
- **Error tracking is self-hosted** (2026-11-26, #212/#293): no outside service.

- **No UI test on PRs for now** (2026-11-24): it would add ~1 minute before a PR can merge;
  the owner prefers faster merges. Revisit if UI breakage keeps reaching production (as
  ag-grid 36 did, #127).
- **CodeQL false positives are dismissed by `security-fix.yml` itself** (#124), not the owner.
- **Production API keys from the old `Math.random()` generator aren't rotated** (not now).
- **The agent may merge its own PR for fixes to the automation** once CI passes, including
  `.github/` changes; say what was merged.
- **Local permission carve-outs** (2026-11-25, `.claude/settings.local.json`, gitignored): the
  agent may run `gh pr merge`, `gh pr edit`, `gh issue edit` and `gh run cancel` without a
  prompt. Merge only what the owner asked for or automation fixes, and say what was merged.
- **Docs stay in the repo** (2026-11-25): agents and workflows read them; the wiki only has an
  overview page with the diagrams. `OPERATIONS.md` stays in the repo too.
- Dev-only Dependabot alerts that can't reach production may be dismissed as tolerable risk
  (alert #2, `minimatch` via jest/nodemon).

## Working rules (beyond AGENTS.md)

- **Production is real.** Run `deploy/deploy.sh` server commands (`up`, `migrate`, `init-db`,
  `compose`, `bootstrap`) only when the user asks. `up` ships the committed `HEAD` of the
  checked-out branch, so deploy from `main`, and **run `npm run secrets:pull` first**: `up`
  copies the local `deploy/prod.env` over the server's (a stale copy once nearly turned off the
  backups and Telegram).
- **Don't run the smoke tests locally** unless asked; CI runs `api-smoke.mjs`, and `e2e.yml`
  runs the UI test. To try a `ui-smoke.mjs` change against production before merging, run
  `gh workflow run e2e.yml --ref <branch>`.
- Check backend changes with build + `npm test` (`verify-backend`), frontend changes with build,
  lint and `typecheck`.

## Things to know

- **The repo is public.** History was scrubbed of secrets on 2026-11-14 and force-pushed; any
  older clone must be re-cloned. `~/dev/invokedb-pre-scrub-2026-11-14.bundle` holds secrets:
  never push it. Artifacts are public too, so never upload a Playwright trace from CI.
- **Secrets:** `.env` and `deploy/prod.env` (gitignored) and the SSH key `~/.ssh/invokedb` sync
  to Dropbox with `npm run secrets:push`/`pull`; `secrets:status` should show `same`. GitHub
  secrets: repo (`CLAUDE_CODE_OAUTH_TOKEN`, `PROJECTS_TOKEN`, `E2E_*`, `TELEGRAM_*`) and the
  `production` environment (deploy).
- **SSH to production only from the user's home IP** (Cloud Firewall `invokedb-prod`). If SSH
  times out, the home IP changed: update the rule, or use the droplet's Web Console.
- **`HORIZON_WS_SERVER_TOKEN`**: the shared secret backend processes register with the
  websocket broker. Optional locally, required elsewhere; the same value in every process.
- **`GET /health`** answers 200 once the process's websocket clients are registered (503
  before); `api-smoke.mjs` and `e2e.yml` wait on it. UptimeRobot watches `/auth/authorize`,
  which doesn't touch the DBs.
- **Logins:** locally `demo@invokedb.com` … `demo7@`, password `password`. In production those
  accounts have random passwords and API keys; get in with a password reset (mail to
  `@invokedb.com` reaches the support Gmail).
- **GitHub Actions gotchas** (learned building the automation):
  - Anything done with the workflow token starts no other workflows, and `workflow_run` doesn't
    fire for its runs; only `workflow_dispatch` is exempt. So automerge starts CI, CI starts CD,
    CD starts E2E, and the agent workflows poke the queue directly.
  - Inside `claude-code-action`, `gh` uses the Claude app's token (which does start workflows);
    `git push` only does with checkout's `persist-credentials: false` (#46).
  - A dispatched CI run doesn't count toward a PR's required checks (#40).
  - `claude-code-action` only runs a workflow file identical to `main`'s, so a PR changing
    `review.yml` gets "no verdict line" and `review-changes`; expected (#31, #34).
  - It refuses bot-started runs unless the bot is in `allowed_bots` (#35).
  - A PR merged with the workflow token doesn't close its `Closes #N` issues (#67).
  - `gh --jq` has no `--arg`; use `env.NAME` in the filter.
  - A fix PR merged into a PR branch with the workflow token starts no CI there; repair now
    pushes onto agent PR branches instead (#135, #267). For anything else, close and reopen the
    PR to start its CI.
  - GitHub's scheduled (`cron`) runs are best-effort: they can be hours late or skipped.
- **Open loose ends are issues** (see the board). `/api/v1/get` leaving out empty cells looks
  intended.
- **Background:** Mailgun sends from `mail.invokedb.com` because the old account still holds
  `mg.`; Hetzner was dropped (US prices tripled, June 2026); a bigger droplet is a resize (raise
  `MONGO_CACHE_GB` and `PRC_CPUS`). An SSO login never links to an account that has a password
  (`password_account`), since password signup doesn't verify the email.
- **MCP servers:** `playwright` (real Chrome; never to check changes unless asked) and
  `mongodb` (read-only, `connectionId: "preconfigured"`); see AGENTS.md.
