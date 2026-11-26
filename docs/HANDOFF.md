# InvokeDB: handoff

_Last updated 2026-11-26 (late night)_

InvokeDB ("horizon") is an **agentic web database**, "the database for you and your AI agents":
tables people edit like a spreadsheet and code and AI agents use through an API (and soon an MCP
server), live at `https://invokedb.com`. This file says where things stand and what a new session
must know.
Elsewhere:

- `AGENTS.md`: rules, conventions, gotchas (read first). `README.md`: commands.
- **The Project board "InvokeDB"** (https://github.com/users/stevehetz/projects/1): all work,
  in priority order. "What's next" is the top `Todo` item (AGENTS.md, "How work is tracked").
- `docs/OPERATIONS.md`: every outside service and GitHub workflow, its secrets by name, who it
  alerts, how to check it. `deploy/README.md`: the server and deploys.
- `docs/INFRASTRUCTURE_PLAN.md`: the hosting direction (one server, keeping Mongo, a free tier
  then paid plans). `docs/PRICING.md`: tiers, limits, costs and their test plan (#137).
  `docs/GO_LIVE.md`: the owner's checklist for taking real money (the business, bank account,
  trademark and Stripe live mode).
  `docs/DEPENDENCY_PINS.md`: packages that only move by a rule. Feature ideas are issues on the
  board, not docs (`SAAS_PLAN.md`, `AI_IDEAS.md` and `CODE_REVIEW.md` were retired 2026-11-25).
- The GitHub wiki has an Infrastructure page with the diagrams from `docs/images/`; the docs in
  the repo stay the source of truth (agents and workflows read them).
- Git history and closed issues/PRs: everything done so far.

## Where things stand (2026-11-26, night)

Production is green (CD and E2E passed for `main` at `9e6509c`, ~16:55 UTC on 2026-11-26). No
PRs are open. Everything below is merged and deployed. Details: `gh pr list --state merged`.

- **Shipped 2026-11-26 (owner session):**
  - **Light and dark theme** (#290, reached `main` inside **#301**; #290 closed by hand). In light mode the app header
    and the tables pane's icon rail stay a slate (`$light-rail` in `theme-tokens.scss`).
  - **#301, theme polish** found testing it: column defs carry the backend's fields in
    `colDef.context` (`h-data-grid/col-def.js`, #295/#296; ag-grid 36 flags unknown colDef
    properties, so strip strays like `row_num` in `to_grid`); the grid's top-bar buttons fold
    into the More (…) menu when the bar is narrow (#297/#298); "Loading..." only after 400 ms;
    Help moved into the account menu; a redesigned **pricing page** (plan cards, Starter
    featured, yearly prices); dark form pages and the home hero use a soft indigo glow
    (`form-page-bg` token); `batch_create` with an empty batch is a no-op; table rows in
    `thead`/`tbody` (#299).
  - **#303**: the UI test's theme step checks the page background (the header stays slate).
  - **#306, the rebrand** (#304): home page, title and meta tags, help, guide and README now say
    "The database for you and your AI agents" with the label "Agentic web database". The GitHub
    repo's description and topics (`ai-agents`, `agentic-ai`) were updated to match; add
    `mcp-server` now that #307 has shipped.
- **#307, the MCP server (#305): merged and live** (`https://api.invokedb.com/mcp` answers 401
  without a key). `POST /mcp` with an API
  key; tools `list_tables`, `describe_table`, `query_rows`, `count_rows`, and for read-write keys
  `create_rows`, `update_rows`, `delete_rows`. **No MCP SDK** (chosen in the session and explained
  in the PR: the SDK pulls in Hono, Express, jose and more); `src/core/mcp/mcp.ts` is a small, pure, stateless
  JSON-RPC implementation, checked with the official SDK client 1.32.2. The Account page's API
  Keys panel has a "Use with AI agents" box; help topic `agents`; AGENTS.md has the conventions.

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
- **#184 shipped** (#280: read-only over-cap accounts, deleting idle free accounts).
- **Billing shipped, off in production** (#129, **#310** merged 2026-11-26; replaced #153,
  closed): see "Stripe and going live" below.
- **Queue (`agent`):** #268 (E2E transient 502) and **#279** (delete an account's data on account
  deletion). #279 is still `agent-stuck` from when it waited on #280, which has merged: remove
  `agent-stuck` to let the agent retry it (its PR must open with `hold`: it deletes data).
- **Ideas the rebrand points to** (not issues yet): more agent features on top of the MCP
  server, e.g. MCP tools for views or table creation, an agent-friendly quickstart page.
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
- **Tests:** backend unit tests (Jest, ~1,000), the API smoke test and the Python client's tests
  on every PR; the UI test
  (`scripts/ui-smoke.mjs`) runs **against production** only (`e2e.yml`: nightly 06:00 UTC and
  after each deploy, as `e2e@invokedb.com`; a failure sends Telegram, keeps a masked screenshot
  and starts repair). The frontend has no tests of its own.

## Stripe and going live (2026-11-26)

- **The code is done** (#310): Starter and Pro, monthly or yearly, through Stripe Checkout; the
  Customer Portal to change plan, cancel or update the card; a signed webhook
  (`POST /billing/webhook`) that re-reads the customer's subscriptions from Stripe and sets the
  plan; the 14-day grace period on a failed payment; the subscription cancelled when grace ends
  or the account is deleted. How it works: AGENTS.md ("Billing") and `docs/OPERATIONS.md`
  ("Stripe"), which also has the dashboard setup steps.
- **Production:** merged and deployed with **billing off**: `prod.env` has no Stripe keys yet,
  so the upgrade buttons are hidden and `/billing/*` answers 503. Nothing else is needed until
  the business can take money.
- **Stripe sandbox:** a separate Stripe account named **InvokeDB** (not the owner's older
  otam.vercel.app account; don't use that one's keys). In its sandbox: products InvokeDB
  Starter and InvokeDB Pro with the four prices and their lookup keys
  (`invokedb_starter_month`/`_year`, `invokedb_pro_month`/`_year`), the Customer Portal
  (switching between the four prices; downgrades and cancels at the period end) and the
  default retries (8 within 2 weeks, then cancel). Tax setup was skipped (decide before live).
- **Testing locally:** the owner's `.env` has the sandbox `STRIPE_SECRET_KEY` and the
  `STRIPE_WEBHOOK_SECRET` of the Stripe CLI (installed with Homebrew). Run `npm run dev`, then
  forward webhooks without `stripe login`:
  `stripe listen --api-key "$STRIPE_SECRET_KEY" --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.paused,customer.subscription.resumed,invoice.paid,invoice.payment_failed --forward-to 127.0.0.1:8001/billing/webhook`
  (this CLI version requires `--events`). Sign up a new account (the demo accounts are internal
  and can't buy), Account → Get Starter, card `4242 4242 4242 4242`. Checked end to end
  2026-11-26: the plan, caps and renewal date update within seconds, even with the events
  arriving out of order.
- **What blocks real money: the business.** The original InvokeDB, LLC (Ohio) was **dissolved
  in 2021** and its bank account closed. The owner doesn't want to sell as a sole proprietor
  (liability), so a **new LLC** comes first, then an EIN, an operating agreement and a business
  bank account, then Stripe's live-mode verification and the live setup, then the site's
  legal pages; the trademark renewal last. The checklist, in order: **`docs/GO_LIVE.md`**. The
  owner files the LLC themselves (step 2) and will pick this up later in another session.
- **For the session that picks this up:** ask where the owner is in `docs/GO_LIVE.md` and give
  only the next step. Claude can't file, sign, pay, enter ID/bank details or pass Stripe's
  identity checks; it can walk through each screen, then do the live Stripe setup (products,
  portal, webhook endpoint) once the account is verified, and prepare the Terms/Privacy update.

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
  then paid tiers through **Stripe** (#129, shipped in #310, off until the business is set
  up: `docs/GO_LIVE.md`). Caps and prices come from the pricing review (#137). This replaced
  "a trial instead of a free tier".
- **No selling as a sole proprietor** (2026-11-26): real payments wait for a new InvokeDB, LLC
  (the old one was dissolved in 2021); the owner files it. Trademark renewal is done last.

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
- **Positioning** (2026-11-26, #304): "The database for you and your AI agents", labelled an
  "agentic web database". Claims on the site must be features that ship; agents connect through
  the API and the MCP server (#305).
- **Look** (2026-11-26): in light mode the app header and icon rail stay slate; the pricing page
  features **Starter** as "Most popular" (`FEATURED_PLAN` and the taglines in `pricing.js`); dark
  form pages and the home hero use the indigo glow.

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
- **After pulling `main`, run `npm run db:setup`** before `npm run dev`: a new migration otherwise
  shows up as errors like `column Account.plan_state does not exist` (sign-in fails). It only
  runs pending migrations.
- **Edit files with the Edit/Write tools**, not inline `python3`/heredoc scripts: auto mode
  can't read those, stops for approval and then times out.
- The owner reads GitHub notifications in the GitHub mobile app (email is off), so `needs-owner`
  and `agent-stuck` reach them as @mentions there.

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
