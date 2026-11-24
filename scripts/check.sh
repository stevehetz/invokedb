#!/usr/bin/env bash
# `npm run check`: the checks CI runs, minus the API smoke test (that one needs databases, see
# the verify-backend playbook). Green here should mean green in CI:
#   backend build + lint + unit tests, frontend build (no Sass deprecation warnings) + lint,
#   the examples (invokedb-node tsc, Angular ng build), shellcheck, prettier --check.
# Expects `npm install` to have run; installs the examples' own node_modules if they're missing.
# Stops at the first failure.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

step() { printf '\n==> %s\n' "$*"; }

step 'Backend: build, lint, unit tests'
npm --prefix packages/horizon-be run build
npm --prefix packages/horizon-be run lint
npm --prefix packages/horizon-be test

step 'Frontend: build (fails on Sass deprecation warnings), lint'
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
npm --prefix packages/horizon-fe run build 2>&1 | tee "$log"
if grep -qi 'deprecation warning' "$log"; then
  echo 'The frontend build printed Sass deprecation warnings (see above)' >&2
  exit 1
fi
npm --prefix packages/horizon-fe run lint

for ex in invokedb-node angular; do
  step "examples/$ex: build"
  [ -d "examples/$ex/node_modules" ] || npm --prefix "examples/$ex" ci --no-audit --no-fund
  NG_CLI_ANALYTICS=false npm --prefix "examples/$ex" run build
done

step 'shellcheck deploy/*.sh scripts/*.sh'
if command -v shellcheck >/dev/null; then
  shellcheck deploy/*.sh scripts/*.sh
else
  echo 'SKIPPED: shellcheck is not installed (brew install shellcheck); CI still runs it' >&2
fi

step 'prettier --check'
node_modules/.bin/prettier --check .

step 'All checks passed'
