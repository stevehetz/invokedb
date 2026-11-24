# Workstream

_Last updated 2026-11-24_

The task in progress, as a full ordered checklist. **Agents keep this file current**: tick a
step off as soon as it's done, add any step that turns up, and keep the "Now" marker on the
next one. When the user asks "what's next", give them **only the "Now" step** (one step, with
the exact clicks or command), never the whole list. `docs/HANDOFF.md` has the background and
history; this file has only the steps.

Who: **You** = the user; **Claude** = a coding agent (it says when it needs your OK).

## Automated review, repair and a merge rule

Requested 2026-11-24. Decided: changes go to `main` through pull requests; Claude reviews each
PR; when CI or CD fails, Claude opens a fix PR (or an issue when the cause isn't in the code);
`main` requires a PR with CI passing. Auth: the user's Claude subscription
(`CLAUDE_CODE_OAUTH_TOKEN`) through the Claude GitHub App. Later, not now: the API smoke test in
CI.

- [x] 1. (2026-11-24) Claude, branch `claude-automation`: `.github/workflows/review.yml`
      (same-repo PRs, read-only tools plus PR comments), `.github/workflows/repair.yml`
      (`workflow_run` on CI/CD failure, skips `claude/` branches and forks), CI on `push`
      only (no double runs on PRs), the site link on CD deployments, AGENTS.md and HANDOFF
      updated for the PR flow.
- [x] 2. (2026-11-24) Claude GitHub App installed on `stevehetz/invokedb` only.
- [x] 3. (2026-11-24) You: `! claude setup-token`, then
      `! gh secret set CLAUDE_CODE_OAUTH_TOKEN -R stevehetz/invokedb` and paste the token.
- [x] 4. (2026-11-24) Pushed, PR #1 opened. CI passed. The review ran, got its app token
      (so the app is installed), then skipped on purpose: the action only runs a workflow file
      identical to the one on `main`, so review and repair start working once merged (and a
      PR that changes them isn't reviewed by its own version).
- [x] 5. (2026-11-24) PR #1 merged and deployed (`8c9fde1`).
- [x] 6. (2026-11-24) Ruleset "main: PR with CI passing" (id 27985352): PR required, checks
      `backend`, `frontend`, `format` must pass, no deletion or force-push; admins bypass only
      through a PR.
- [x] 7. (2026-11-24) First test: a typo on branch `repair-test` failed CI; Repair opened PR #2
      (correct one-line fix, good write-up, opened as `app/claude`). Three problems: CI didn't
      run on the fix branch (its push used the workflow token, which starts no workflows), the
      review refused a bot-opened PR, and the commit and PR carried AI attribution. PR #2
      closed and its branch deleted.
- [ ] 8. **Now.** Claude, PR `automation-fixes`: repair starts CI on its fix branch with
      `gh workflow run` (CI gained `workflow_dispatch`); review allows the `claude` bot; the
      repair prompt forbids attribution. You: merge it.
- [ ] 9. Claude: rerun the test (push to `repair-test` again); check CI and the review run on
      the fix PR. Then close it and delete `repair-test` and the fix branch.

## Done: GitHub Actions CI/CD

Requested 2026-11-23. CI on every push and PR; then CD to the droplet. There's no `.github/`
yet. Support email and alert routing (the previous workstream) is done: HANDOFF step 5,
"Still to do", item 4.

- [x] 1. Deploys are **automatic** on every push to `main` (decided 2026-11-23), after CI
      passes.
- [x] 2. (2026-11-23) Sass `color-functions` deprecation fixed: the 11 `lighten()` calls in
      `stylesheet.scss` are now `color.adjust(…, $lightness: …)` (same colours), so the
      frontend build has no Sass warnings. Also fixed a `clor:` typo there (the disabled API
      button's hover colour) that esbuild warned about.
- [x] 3. (2026-11-23) `.github/workflows/ci.yml` on branch `ci-cd`: three parallel jobs
      (backend `npm ci --omit=optional` + `build` + `lint`; frontend `npm ci` + `build`,
      failing on any Sass `deprecation warning` in its output, + `lint`; root
      `prettier --check .`). Node from `.nvmrc`, no secrets. The backend lint had 5 errors
      (string throws, `let` → `const` in `src/websocket/`), now fixed. Checked by running the
      same commands on a clean copy of the repo (no `.env`): all pass.
- [x] 4. (2026-11-23) Pushed; CI passed on GitHub (run 45189419612, after bumping
      `actions/checkout` and `actions/setup-node` to v7 to clear the Node 20 warnings).
      Merged to `main`.
- [x] 5. (2026-11-24) Plan decided. Firewall: the job adds a rule for its own IP to the
      DigitalOcean firewall and removes it afterwards (DO token scoped to firewalls only).
      `prod.env`: **code only**; it stays on the server, GitHub holds no app secrets, and a
      settings change is `deploy.sh env` from the Mac (so there's no third copy to keep in
      step). The deploy key is forced to `ci-deploy.sh`, which deploys only the tip of `main`,
      downloaded from the public repo.
- [x] 6. (2026-11-24) Claude, branch `cd`: `.github/workflows/cd.yml` (runs after CI
      passes on a push to `main`), `deploy/ci-deploy.sh`, `deploy/release.sh` (the build,
      migrate, restart that `up` also uses now), `deploy.sh env` and `install-ci`, a `REVISION`
      file on the server, the server's settings moved out of the app folder to
      `/opt/invokedb/prod.env` (the first deploy of this branch moves them; until then
      use `up`, not `env`), docs in `deploy/README.md` "Automatic deploys" and AGENTS.md. Checked
      with `bash -n` only.
- [x] 7. (2026-11-24) Key `~/.ssh/invokedb-ci` created (not synced to Dropbox; regenerate
      and rerun `install-ci` if lost) and installed with `install-ci`. Checked: the key can't
      run other commands, refuses a commit that isn't main's tip, and the normal key still
      works.
- [x] 8. (2026-11-24) DigitalOcean token `invokedb-ci-firewall` created (custom scopes
      `firewall:read` + `firewall:update`, no expiry). Firewall `invokedb-prod` ID:
      `899d3a6f-c451-4672-b005-68672d6b8cbf`.
- [x] 9. (2026-11-24) GitHub environment `production` (deployment branches: `main` only):
      secrets `DEPLOY_SSH_KEY`, `DO_FIREWALL_TOKEN`; variables `DEPLOY_HOST`,
      `DO_FIREWALL_ID`, `DEPLOY_KNOWN_HOSTS` (checked against the Mac's `known_hosts`).
- [x] 10. (2026-11-24) First automatic deploy (run 45395180705, 1m54s) shipped `0578780`.
      Checked: `REVISION` matches, settings moved to `/opt/invokedb/prod.env` (root-only), all
      containers up, site, `/app` and the API answer 200, the firewall rule was removed. The
      server's settings match the Mac's except the two `MAILGUN_SMTP_*` lines, which the
      backend doesn't read.
- [x] 11. (2026-11-24) Workflow renamed Deploy → CD (`.github/workflows/cd.yml`), branch
      `cd-rename`; merged, and the push deployed through it (`4fa7575`).

## Up next

1. A person checks signup, table creation, CSV upload and API calls in production.
2. 5b: Google and GitHub sign-in (HANDOFF, Next steps).
