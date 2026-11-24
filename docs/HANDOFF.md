# InvokeDB: handoff

_Last updated 2026-11-24_

InvokeDB ("horizon") is a web app for building data tables you can query through an API, live at
`https://invokedb.com`. This file says where things stand and what a new session must know.
Elsewhere:

- `AGENTS.md`: rules, conventions, gotchas (read first). `README.md`: commands.
- **The Project board "InvokeDB"** (https://github.com/users/stevehetz/projects/1): all work,
  in priority order. "What's next" is the top `Todo` item (AGENTS.md, "How work is tracked").
- `docs/OPERATIONS.md`: every outside service and GitHub workflow, its secrets by name, who it
  alerts, how to check it. `deploy/README.md`: the server and deploys.
- Plans: `docs/INFRASTRUCTURE_PLAN.md` (current direction: a trial-only showcase on one server,
  keeping Mongo), `docs/SAAS_PLAN.md`, `docs/AI_IDEAS.md`. `docs/DEPENDENCY_PINS.md`: packages
  that only move by a rule.
- Git history and closed issues/PRs: everything done so far.

## Where things stand (2026-11-24)

- **Board:** ideas filed 2026-11-24 (#128–#137): the pricing review (#137) and Stripe (#129)
  lead; `main` is deployed, no open PRs or security alerts.
- **Production:** one DigitalOcean droplet running `docker compose` (Caddy, API, CSV processor,
  Postgres 17, Mongo 8). Nightly encrypted off-site backups, UptimeRobot, Healthchecks, Mailgun
  email, Cloudflare DNS and Email Routing, Google and GitHub sign-in (checked by hand).
- **Delivery:** every change goes through a PR: CI, a Claude review, auto-merge for safe PRs,
  deploy on merge. Claude workflows also repair failed CI/CD, revise after review, resolve
  conflicts, work `agent`-labelled issues, fix or dismiss CodeQL alerts every 3 hours and update
  npm packages monthly. Merged branches are deleted automatically.
- **Tests:** backend unit tests (Jest, ~109) and the API smoke test (~54 checks) on every PR;
  the UI test (`scripts/ui-smoke.mjs`, 12 steps) runs **against production** only
  (`e2e.yml`: nightly 06:00 UTC and after each deploy, as `e2e@invokedb.com`; a failure sends
  Telegram and keeps a masked screenshot). The frontend has no tests of its own.

## Decisions to respect

- **Pricing direction** (2026-11-24): a **very limited free tier** so people can try it out,
  then paid tiers through **Stripe, which comes back** (#129). Caps and prices come from the
  pricing review (#137). This replaced "a trial instead of a free tier".

- **No UI test on PRs for now** (2026-11-24): it would add ~1 minute before a PR can merge;
  the owner prefers faster merges. Revisit if UI breakage keeps reaching production (as
  ag-grid 36 did, #127).
- **CodeQL false positives are dismissed by `security-fix.yml` itself** (#124), not the owner.
- **Production API keys from the old `Math.random()` generator aren't rotated** (not now).
- **The agent may merge its own PR for fixes to the automation** once CI passes, including
  `.github/` changes; say what was merged.
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
  - When automerge pushes a repair fix into a PR branch, GitHub treats `github-actions[bot]` as
    a first-time contributor and waits for "Approve workflows to run" (#107). Not fixed.
- **Open loose ends are issues:** the infrastructure diagram (#128), unifying the stylesheets
  (#130), splitting the entry chunk (#131), email verification (#132), rate limits on
  email-sending routes (#133), checking the grid's look (#134), the "Approve workflows" click
  (#135), archiving the old example repos (#136). The old `subscription` / `stripe_env` tables
  and `stripe_*` columns are reused or dropped by #129. `/api/v1/get` leaving out empty cells
  looks intended.
- **Background:** Mailgun sends from `mail.invokedb.com` because the old account still holds
  `mg.`; Hetzner was dropped (US prices tripled, June 2026); a bigger droplet is a resize (raise
  `MONGO_CACHE_GB` and `PRC_CPUS`). An SSO login never links to an account that has a password
  (`password_account`), since password signup doesn't verify the email.
- **MCP servers:** `playwright` (real Chrome; never to check changes unless asked) and
  `mongodb` (read-only, `connectionId: "preconfigured"`); see AGENTS.md.
