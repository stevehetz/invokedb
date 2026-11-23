# Workstream

_Last updated 2026-11-23_

The task in progress, as a full ordered checklist. **Agents keep this file current**: tick a
step off as soon as it's done, add any step that turns up, and keep the "Now" marker on the
next one. When the user asks "what's next", give them **only the "Now" step** (one step, with
the exact clicks or command), never the whole list. `docs/HANDOFF.md` has the background and
history; this file has only the steps.

Who: **You** = the user; **Claude** = a coding agent (it says when it needs your OK).

## GitHub Actions CI/CD

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
- [ ] 4. **Now.** You: push the branch and check the run passes on GitHub; merge.
- [ ] 5. Claude: plan the CD job: an SSH deploy key, the `prod.env` values as GitHub secrets
      (the repo is public, so nothing secret in the workflow or logs), and how the runner gets
      past the home-IP-only SSH firewall. With automatic deploys, the GitHub copy of
      `prod.env` becomes what ships, so plan how it stays in step with the Dropbox copy.
      Present the options before building it.
- [ ] 6. You + Claude: set up the key, secrets and firewall rule; Claude writes the deploy
      workflow; you run the first deploy through it.

## Up next

1. A person checks signup, table creation, CSV upload and API calls in production.
2. 5b: Google and GitHub sign-in (HANDOFF, Next steps).
