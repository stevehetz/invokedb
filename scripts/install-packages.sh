#!/usr/bin/env bash
# Installs both packages (they have separate node_modules; there are no npm workspaces).
# Runs as the root `postinstall`, so a plain `npm install` at the root sets up everything.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# --omit=optional skips the native Postgres log transport (needs a C toolchain; only used in prod)
npm --prefix packages/horizon-be install --no-audit --no-fund --omit=optional
npm --prefix packages/horizon-fe install --no-audit --no-fund
